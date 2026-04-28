import type { Pool } from 'pg';
import type { BacktestEvent, DataSource } from '../types';

export interface PostgresFillSourceOptions {
  pool: Pool;
  pair: string;
  fromMs: number;
  toMs: number;
}

export class PostgresFillSource implements DataSource {
  private yielded = 0;

  constructor(private opts: PostgresFillSourceOptions) {}

  async *iterate(): AsyncIterable<BacktestEvent> {
    const r = await this.opts.pool.query(
      `SELECT id, pair, side, price, qty, executed_at FROM fills_ledger
       WHERE pair = $1 AND executed_at BETWEEN to_timestamp($2/1000.0) AND to_timestamp($3/1000.0)
       ORDER BY executed_at`,
      [this.opts.pair, this.opts.fromMs, this.opts.toMs],
    );
    for (const row of r.rows as any[]) {
      this.yielded++;
      yield {
        ts: new Date(row.executed_at).getTime(),
        kind: 'tick', pair: row.pair, price: Number(row.price), raw: row,
      };
    }
  }

  coverage(): number {
    return this.yielded === 0 ? 0 : 1;
  }
}
