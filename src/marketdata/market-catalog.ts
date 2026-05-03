import { ulid } from 'ulid';
import type { Pool } from 'pg';
import type { AppLogger } from '../logging/logger';
import type { SignalBus } from '../signals/bus';
import { CoinDCXApi } from '../gateways/coindcx-api';

type MarketDetailsRecord = Record<string, unknown>;

type CatalogRow = {
  pair: string;
  symbol: string;
  ecode: string;
  precision_base: number | null;
  precision_quote: number | null;
  step: string | null;
  min_notional: string | null;
  max_leverage: string | null;
  payload: Record<string, unknown>;
  refreshed_at: string;
};

const UPSERT_MARKET_SQL = `
  INSERT INTO market_catalog (
    pair, symbol, ecode, precision_base, precision_quote, step, min_notional, max_leverage, payload, refreshed_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
  ON CONFLICT (pair) DO UPDATE SET
    symbol = EXCLUDED.symbol,
    ecode = EXCLUDED.ecode,
    precision_base = EXCLUDED.precision_base,
    precision_quote = EXCLUDED.precision_quote,
    step = EXCLUDED.step,
    min_notional = EXCLUDED.min_notional,
    max_leverage = EXCLUDED.max_leverage,
    payload = EXCLUDED.payload,
    refreshed_at = EXCLUDED.refreshed_at
`;

const READ_CATALOG_SQL = `
  SELECT pair, symbol, ecode, precision_base, precision_quote, step, min_notional, max_leverage, payload, refreshed_at
  FROM market_catalog
`;

const STALE_CHECK_SQL = `
  SELECT now() - max(refreshed_at) AS max_age
  FROM market_catalog
`;

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRow(raw: MarketDetailsRecord, refreshedAt: string): CatalogRow | null {
  const pair = toStringOrNull(raw.pair) ?? toStringOrNull(raw.coindcx_name);
  const symbol = toStringOrNull(raw.symbol) ?? toStringOrNull(raw.coindcx_name);
  const ecode = toStringOrNull(raw.ecode);
  if (!pair || !symbol || !ecode) return null;

  return {
    pair,
    symbol,
    ecode,
    precision_base: toNumberOrNull(raw.base_currency_precision),
    precision_quote: toNumberOrNull(raw.target_currency_precision),
    step: toStringOrNull(raw.step),
    min_notional: toStringOrNull(raw.min_notional),
    max_leverage: toStringOrNull(raw.max_leverage),
    payload: raw,
    refreshed_at: refreshedAt,
  };
}

export interface MarketCatalogEntry {
  pair: string;
  symbol: string;
  ecode: string;
  precisionBase: number | null;
  precisionQuote: number | null;
  step: string | null;
  minNotional: string | null;
  maxLeverage: string | null;
  payload: Record<string, unknown>;
  refreshedAt: string;
}

export interface MarketCatalogOptions {
  pool: Pool;
  logger: AppLogger;
  bus: SignalBus;
  refreshMs?: number;
  staleAlertMs?: number;
}

export class MarketCatalog {
  private readonly byPair = new Map<string, MarketCatalogEntry>();
  private readonly bySymbol = new Map<string, MarketCatalogEntry>();
  private readonly byEcode = new Map<string, MarketCatalogEntry[]>();
  private readonly refreshMs: number;
  private readonly staleAlertMs: number;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private staleAlertActive = false;
  private inFlightRefresh?: Promise<void>;

  constructor(private readonly opts: MarketCatalogOptions) {
    this.refreshMs = opts.refreshMs ?? 15 * 60_000;
    this.staleAlertMs = opts.staleAlertMs ?? 30 * 60_000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.refreshNow('startup');
    this.timer = setInterval(() => {
      void this.refreshNow('interval');
    }, this.refreshMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlightRefresh;
  }

  snapshot() {
    return {
      byPair: new Map(this.byPair),
      bySymbol: new Map(this.bySymbol),
      byEcode: new Map([...this.byEcode.entries()].map(([k, v]) => [k, [...v]])),
    };
  }

  async refreshNow(reason: 'startup' | 'interval' | 'manual' = 'manual'): Promise<void> {
    if (this.stopped) return;
    if (this.inFlightRefresh) {
      await this.inFlightRefresh;
      return;
    }
    this.inFlightRefresh = this.doRefresh(reason).finally(() => {
      this.inFlightRefresh = undefined;
    });
    await this.inFlightRefresh;
  }

  private async doRefresh(reason: string): Promise<void> {
    try {
      const rows = await this.pullAndPersist();
      this.rebuildCaches(rows);
      this.opts.logger.info(
        { mod: 'market-catalog', reason, count: rows.length },
        'market catalog refreshed',
      );
      await this.checkStaleness(rows.length > 0);
    } catch (err: any) {
      this.opts.logger.warn(
        { mod: 'market-catalog', reason, err: err?.message ?? String(err) },
        'market catalog refresh failed',
      );
      await this.emitSignal('warn', 'catalog.refresh_failed', {
        reason,
        error: err?.message ?? String(err),
      });
    }
  }

  private async pullAndPersist(): Promise<CatalogRow[]> {
    const fetched = await CoinDCXApi.getMarketDetails();
    const list: MarketDetailsRecord[] = Array.isArray(fetched) ? fetched : [];
    const refreshedAt = new Date().toISOString();

    for (const raw of list) {
      const row = toRow(raw, refreshedAt);
      if (!row) continue;
      await this.opts.pool.query(UPSERT_MARKET_SQL, [
        row.pair,
        row.symbol,
        row.ecode,
        row.precision_base,
        row.precision_quote,
        row.step,
        row.min_notional,
        row.max_leverage,
        JSON.stringify(row.payload),
        row.refreshed_at,
      ]);
    }

    const read = await this.opts.pool.query(READ_CATALOG_SQL);
    return read.rows as CatalogRow[];
  }

  private rebuildCaches(rows: CatalogRow[]): void {
    this.byPair.clear();
    this.bySymbol.clear();
    this.byEcode.clear();

    for (const row of rows) {
      const entry: MarketCatalogEntry = {
        pair: row.pair,
        symbol: row.symbol,
        ecode: row.ecode,
        precisionBase: row.precision_base,
        precisionQuote: row.precision_quote,
        step: row.step,
        minNotional: row.min_notional,
        maxLeverage: row.max_leverage,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        refreshedAt: new Date(row.refreshed_at).toISOString(),
      };
      this.byPair.set(entry.pair, entry);
      this.bySymbol.set(entry.symbol, entry);
      const bucket = this.byEcode.get(entry.ecode) ?? [];
      bucket.push(entry);
      this.byEcode.set(entry.ecode, bucket);
    }
  }

  private async checkStaleness(hasRows: boolean): Promise<void> {
    if (!hasRows) {
      if (!this.staleAlertActive) {
        this.staleAlertActive = true;
        await this.emitSignal('critical', 'catalog.stale', {
          reason: 'empty_catalog',
          staleAlertMs: this.staleAlertMs,
        });
      }
      return;
    }

    const result = await this.opts.pool.query(STALE_CHECK_SQL);
    const maxAge = result.rows[0]?.max_age as { milliseconds?: number } | undefined;
    const ageMs = Number(maxAge?.milliseconds ?? 0);
    if (Number.isFinite(ageMs) && ageMs > this.staleAlertMs) {
      if (!this.staleAlertActive) {
        this.staleAlertActive = true;
        await this.emitSignal('critical', 'catalog.stale', {
          ageMs,
          staleAlertMs: this.staleAlertMs,
        });
      }
      return;
    }

    if (this.staleAlertActive) {
      this.staleAlertActive = false;
      await this.emitSignal('info', 'catalog.recovered', { ageMs, staleAlertMs: this.staleAlertMs });
    }
  }

  private async emitSignal(
    severity: 'info' | 'warn' | 'critical',
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.opts.bus.emit({
      id: ulid(),
      ts: new Date().toISOString(),
      strategy: 'market.catalog',
      type,
      severity,
      payload,
    });
  }
}
