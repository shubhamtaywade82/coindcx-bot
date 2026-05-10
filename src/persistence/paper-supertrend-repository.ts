import type { Pool } from 'pg';

export type PaperSupertrendSide = 'LONG' | 'SHORT';
export type PaperSupertrendStatus = 'open' | 'closed_tp' | 'closed_manual';

export interface PaperSupertrendLeg {
  ts: string;
  price: number;
  notionalUsdt: number;
  qty: number;
}

export interface PaperSupertrendPosition {
  id: string;
  pair: string;
  side: PaperSupertrendSide;
  status: PaperSupertrendStatus;
  openedAt: string;
  closedAt: string | null;
  capitalUsdt: number;
  legs: PaperSupertrendLeg[];
  avgEntry: number;
  totalNotionalUsdt: number;
  tpPrice: number;
  tpPct: number;
  realizedPnlUsdt: number | null;
  realizedPnlPct: number | null;
  lastMarkPrice: number | null;
  lastMarkPnlPct: number | null;
  lastMarkAt: string | null;
  metadata: Record<string, unknown>;
}

const MARK_THROTTLE_MS = 30_000;

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapRow(row: Record<string, unknown>): PaperSupertrendPosition {
  const legsRaw = row.legs;
  const legs: PaperSupertrendLeg[] = Array.isArray(legsRaw)
    ? (legsRaw as unknown[]).map((l) => {
        const o = l as Record<string, unknown>;
        return {
          ts: String(o.ts ?? ''),
          price: num(o.price),
          notionalUsdt: num(o.notionalUsdt),
          qty: num(o.qty),
        };
      })
    : [];
  const meta = row.metadata;
  const metadata =
    meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return {
    id: String(row.id ?? ''),
    pair: String(row.pair ?? ''),
    side: row.side === 'SHORT' ? 'SHORT' : 'LONG',
    status: (row.status as PaperSupertrendStatus) ?? 'open',
    openedAt: row.opened_at ? new Date(String(row.opened_at)).toISOString() : '',
    closedAt: row.closed_at ? new Date(String(row.closed_at)).toISOString() : null,
    capitalUsdt: num(row.capital_usdt),
    legs,
    avgEntry: num(row.avg_entry),
    totalNotionalUsdt: num(row.total_notional_usdt),
    tpPrice: num(row.tp_price),
    tpPct: num(row.tp_pct),
    realizedPnlUsdt: row.realized_pnl_usdt == null ? null : num(row.realized_pnl_usdt),
    realizedPnlPct: row.realized_pnl_pct == null ? null : num(row.realized_pnl_pct),
    lastMarkPrice: row.last_mark_price == null ? null : num(row.last_mark_price),
    lastMarkPnlPct: row.last_mark_pnl_pct == null ? null : num(row.last_mark_pnl_pct),
    lastMarkAt: row.last_mark_at ? new Date(String(row.last_mark_at)).toISOString() : null,
    metadata,
  };
}

export class PaperSupertrendRepository {
  private lastMarkWriteMs = new Map<string, number>();

  constructor(private readonly pool: Pool) {}

  async findOpen(pair: string): Promise<PaperSupertrendPosition | null> {
    const r = await this.pool.query(
      `SELECT * FROM paper_supertrend_positions WHERE pair = $1 AND status = 'open' LIMIT 1`,
      [pair],
    );
    if (r.rows.length === 0) return null;
    return mapRow(r.rows[0] as Record<string, unknown>);
  }

  async createOpen(input: {
    pair: string;
    side: PaperSupertrendSide;
    capitalUsdt: number;
    legs: PaperSupertrendLeg[];
    avgEntry: number;
    totalNotionalUsdt: number;
    tpPrice: number;
    tpPct: number;
    metadata?: Record<string, unknown>;
  }): Promise<PaperSupertrendPosition | null> {
    try {
      const r = await this.pool.query(
        `INSERT INTO paper_supertrend_positions (
          pair, side, status, capital_usdt, legs, avg_entry, total_notional_usdt,
          tp_price, tp_pct, metadata
        ) VALUES ($1,$2,'open',$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
        RETURNING *`,
        [
          input.pair,
          input.side,
          input.capitalUsdt,
          JSON.stringify(input.legs),
          input.avgEntry,
          input.totalNotionalUsdt,
          input.tpPrice,
          input.tpPct,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      if (r.rows.length === 0) return null;
      return mapRow(r.rows[0] as Record<string, unknown>);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') return null;
      throw e;
    }
  }

  async appendLeg(input: {
    id: string;
    legs: PaperSupertrendLeg[];
    avgEntry: number;
    totalNotionalUsdt: number;
    tpPrice: number;
    tpPct: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE paper_supertrend_positions SET
        legs = $2::jsonb,
        avg_entry = $3,
        total_notional_usdt = $4,
        tp_price = $5,
        tp_pct = $6,
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($7::jsonb, '{}'::jsonb)
      WHERE id = $1 AND status = 'open'`,
      [
        input.id,
        JSON.stringify(input.legs),
        input.avgEntry,
        input.totalNotionalUsdt,
        input.tpPrice,
        input.tpPct,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async updateMark(
    pair: string,
    fields: { lastMarkPrice: number; lastMarkPnlPct: number },
    nowMs: number = Date.now(),
  ): Promise<void> {
    const last = this.lastMarkWriteMs.get(pair) ?? 0;
    if (nowMs - last < MARK_THROTTLE_MS) return;
    this.lastMarkWriteMs.set(pair, nowMs);
    await this.pool.query(
      `UPDATE paper_supertrend_positions SET
        last_mark_price = $2,
        last_mark_pnl_pct = $3,
        last_mark_at = NOW()
      WHERE pair = $1 AND status = 'open'`,
      [pair, fields.lastMarkPrice, fields.lastMarkPnlPct],
    );
  }

  /** Test helper: reset in-memory mark throttle for a pair. */
  _resetMarkThrottleForTests(pair?: string): void {
    if (pair) this.lastMarkWriteMs.delete(pair);
    else this.lastMarkWriteMs.clear();
  }

  async closeTp(input: {
    id: string;
    realizedPnlUsdt: number;
    realizedPnlPct: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE paper_supertrend_positions SET
        status = 'closed_tp',
        closed_at = NOW(),
        realized_pnl_usdt = $2,
        realized_pnl_pct = $3,
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb)
      WHERE id = $1 AND status = 'open'`,
      [
        input.id,
        input.realizedPnlUsdt,
        input.realizedPnlPct,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
