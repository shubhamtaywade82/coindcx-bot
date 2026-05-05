import type { Pool } from 'pg';
import type { Balance, Fill, Order, Position } from './types';

interface QueuedWrite { sql: string; params: any[] }

export interface ChangelogRow {
  entity: 'position' | 'balance' | 'order' | 'fill';
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  cause: 'ws_apply' | 'rest_sweep' | 'divergence';
  severity: 'info' | 'warn' | 'alarm' | null;
}

export interface AccountEventDedupRow {
  clientOrderId: string;
  eventId: string;
  entity: 'order' | 'position' | 'fill';
}

export interface PersistenceOptions {
  pool: Pool;
  retryMax: number;
  onError?: (err: Error, op: 'write' | 'flush', queueDepth: number) => void;
  onQueueOverflow?: (dropped: number, queueDepth: number) => void;
}

const POSITION_SQL = `INSERT INTO positions
  (id, pair, side, active_pos, avg_price, mark_price, liquidation_price, leverage, margin_currency, unrealized_pnl, realized_pnl, opened_at, updated_at, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (id) DO UPDATE SET
    pair=EXCLUDED.pair, side=EXCLUDED.side, active_pos=EXCLUDED.active_pos, avg_price=EXCLUDED.avg_price,
    mark_price=EXCLUDED.mark_price, liquidation_price=EXCLUDED.liquidation_price, leverage=EXCLUDED.leverage,
    margin_currency=EXCLUDED.margin_currency, unrealized_pnl=EXCLUDED.unrealized_pnl,
    realized_pnl=EXCLUDED.realized_pnl, opened_at=EXCLUDED.opened_at, updated_at=EXCLUDED.updated_at, source=EXCLUDED.source`;

const BALANCE_SQL = `INSERT INTO balances (currency, available, locked, updated_at, source)
  VALUES ($1,$2,$3,$4,$5)
  ON CONFLICT (currency) DO UPDATE SET
    available=EXCLUDED.available, locked=EXCLUDED.locked,
    updated_at=EXCLUDED.updated_at, source=EXCLUDED.source`;

const ORDER_SQL = `INSERT INTO orders
  (id, pair, side, type, status, price, total_quantity, remaining_qty, avg_fill_price, position_id, created_at, updated_at, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (id) DO UPDATE SET
    pair=EXCLUDED.pair, side=EXCLUDED.side, type=EXCLUDED.type, status=EXCLUDED.status,
    price=EXCLUDED.price, total_quantity=EXCLUDED.total_quantity, remaining_qty=EXCLUDED.remaining_qty,
    avg_fill_price=EXCLUDED.avg_fill_price, position_id=EXCLUDED.position_id,
    updated_at=EXCLUDED.updated_at, source=EXCLUDED.source`;

const FILL_SQL = `INSERT INTO fills_ledger
  (id, order_id, position_id, pair, side, price, qty, fee, fee_currency, realized_pnl, executed_at, ingested_at, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (id) DO NOTHING`;

const CHANGELOG_SQL = `INSERT INTO account_changelog
  (entity, entity_id, field, old_value, new_value, cause, severity, recorded_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;

const ACCOUNT_EVENT_DEDUP_SQL = `INSERT INTO account_event_dedup
  (client_order_id, event_id, entity)
  VALUES ($1,$2,$3)
  ON CONFLICT (client_order_id, event_id) DO NOTHING`;

export class AccountPersistence {
  private queue: QueuedWrite[] = [];

  constructor(private opts: PersistenceOptions) {}

  async upsertPosition(p: Position): Promise<void> {
    return this.write(POSITION_SQL, [
      p.id, p.pair, p.side, p.activePos, p.avgPrice, p.markPrice ?? null,
      p.liquidationPrice ?? null, p.leverage ?? null, p.marginCurrency,
      p.unrealizedPnl, p.realizedPnl, p.openedAt ?? null, p.updatedAt, p.source,
    ]);
  }

  async upsertBalance(b: Balance): Promise<void> {
    return this.write(BALANCE_SQL, [b.currency, b.available, b.locked, b.updatedAt, b.source]);
  }

  async upsertOrder(o: Order): Promise<void> {
    return this.write(ORDER_SQL, [
      o.id, o.pair, o.side, o.type, o.status, o.price ?? null,
      o.totalQty, o.remainingQty, o.avgFillPrice ?? null, o.positionId ?? null,
      o.createdAt, o.updatedAt, o.source,
    ]);
  }

  async appendFill(f: Fill): Promise<void> {
    return this.write(FILL_SQL, [
      f.id, f.orderId ?? null, f.positionId ?? null, f.pair, f.side,
      f.price, f.qty, f.fee ?? null, f.feeCurrency ?? null, f.realizedPnl ?? null,
      f.executedAt, f.ingestedAt, f.source,
    ]);
  }

  async recordChangelog(row: ChangelogRow): Promise<void> {
    return this.write(CHANGELOG_SQL, [
      row.entity, row.entityId, row.field, row.oldValue, row.newValue, row.cause, row.severity, new Date().toISOString(),
    ]);
  }

  async recordAccountEventDedup(row: AccountEventDedupRow): Promise<boolean> {
    try {
      const result = await this.opts.pool.query(ACCOUNT_EVENT_DEDUP_SQL, [
        row.clientOrderId,
        row.eventId,
        row.entity,
      ]);
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      this.opts.onError?.(err as Error, 'write', this.queue.length);
      return false;
    }
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const w = this.queue[0]!;
      try {
        await this.opts.pool.query(w.sql, w.params);
        this.queue.shift();
      } catch (err) {
        this.opts.onError?.(err as Error, 'flush', this.queue.length);
        return;
      }
    }
  }

  queueSize(): number {
    return this.queue.length;
  }

  private async write(sql: string, params: any[]): Promise<void> {
    try {
      await this.opts.pool.query(sql, params);
    } catch (err) {
      this.queue.push({ sql, params });
      let dropped = 0;
      while (this.queue.length > this.opts.retryMax) {
        this.queue.shift();
        dropped += 1;
      }
      this.opts.onError?.(err as Error, 'write', this.queue.length);
      if (dropped > 0) this.opts.onQueueOverflow?.(dropped, this.queue.length);
    }
  }
}
