import type { Pool } from 'pg';

export interface PersistTradeInput {
  id: string;
  ts: string;
  pair: string;
  side: string;
  price: string | number;
  qty: string | number;
  orderId?: string;
  positionId?: string;
  source: string;
  payload: Record<string, unknown>;
}

const INSERT_TRADE_SQL = `
  INSERT INTO trades (id, ts, pair, side, price, qty, order_id, position_id, source, payload)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
  ON CONFLICT (id) DO NOTHING
`;

export class TradePersistence {
  constructor(private readonly pool: Pool) {}

  async persist(input: PersistTradeInput): Promise<void> {
    await this.pool.query(INSERT_TRADE_SQL, [
      input.id,
      input.ts,
      input.pair,
      input.side,
      input.price,
      input.qty,
      input.orderId ?? null,
      input.positionId ?? null,
      input.source,
      JSON.stringify(input.payload),
    ]);
  }
}
