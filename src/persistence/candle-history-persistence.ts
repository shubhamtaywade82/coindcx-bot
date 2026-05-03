import type { Pool } from 'pg';

export interface PersistableCandle {
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  payload?: Record<string, unknown>;
}

export interface PersistCandlesInput {
  pair: string;
  timeframe: string;
  source: string;
  candles: PersistableCandle[];
}

const UPSERT_CANDLE_SQL = `
  INSERT INTO candles
    (pair, timeframe, open_time, close_time, open, high, low, close, volume, source, payload)
  VALUES
    ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, $6, $7, $8, $9, $10, $11::jsonb)
  ON CONFLICT (pair, timeframe, open_time)
  DO UPDATE SET
    close_time = EXCLUDED.close_time,
    open = EXCLUDED.open,
    high = EXCLUDED.high,
    low = EXCLUDED.low,
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    source = EXCLUDED.source,
    payload = EXCLUDED.payload
`;

export class CandleHistoryPersistence {
  constructor(private readonly pool: Pool) {}

  async persistMany(input: PersistCandlesInput): Promise<number> {
    let persisted = 0;
    for (const candle of input.candles) {
      await this.pool.query(UPSERT_CANDLE_SQL, [
        input.pair,
        input.timeframe,
        candle.openTimeMs,
        candle.closeTimeMs,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        input.source,
        JSON.stringify(candle.payload ?? {}),
      ]);
      persisted += 1;
    }
    return persisted;
  }
}
