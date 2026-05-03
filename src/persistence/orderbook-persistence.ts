import type { Pool } from 'pg';
import type { BookManager } from '../marketdata/book/book-manager';
import type { OrderBook } from '../marketdata/book/orderbook';

const INSERT_ORDERBOOK_SNAPSHOT_SQL = `
  INSERT INTO orderbook_snapshots
    (pair, channel, ts, exchange_ts, best_bid, best_ask, spread, checksum, bids, asks, state)
  VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
`;

const INSERT_REPLAY_ARTIFACT_SQL = `
  INSERT INTO replay_artifacts
    (pair, channel, artifact_kind, ts, exchange_ts, payload)
  VALUES
    ($1,$2,$3,$4,$5,$6::jsonb)
`;

export type ReplayArtifactKind = 'ws_frame' | 'orderbook_gap' | 'orderbook_resync';

export interface ReplayArtifactInput {
  pair?: string;
  channel: string;
  kind: ReplayArtifactKind;
  ts: string;
  exchangeTs?: number;
  payload: Record<string, unknown>;
}

function exchangeTsForPg(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

export class OrderbookPersistence {
  constructor(private readonly pool: Pool) {}

  async persistSnapshot(manager: BookManager, pair: string, channel: string, nowIso: string): Promise<void> {
    const book = manager.get(pair);
    if (!book) return;
    const top = book.topN(20);
    const frame = manager.latestFrame(pair);
    const bestBid = top.bids[0] ? Number(top.bids[0].price) : null;
    const bestAsk = top.asks[0] ? Number(top.asks[0].price) : null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    await this.pool.query(INSERT_ORDERBOOK_SNAPSHOT_SQL, [
      pair,
      channel,
      nowIso,
      exchangeTsForPg(frame?.ts),
      Number.isFinite(bestBid) ? bestBid : null,
      Number.isFinite(bestAsk) ? bestAsk : null,
      Number.isFinite(spread) ? spread : null,
      this.safeChecksum(book),
      JSON.stringify(top.bids),
      JSON.stringify(top.asks),
      book.state(),
    ]);
  }

  async persistArtifact(input: ReplayArtifactInput): Promise<void> {
    await this.pool.query(INSERT_REPLAY_ARTIFACT_SQL, [
      input.pair ?? null,
      input.channel,
      input.kind,
      input.ts,
      exchangeTsForPg(input.exchangeTs),
      JSON.stringify(input.payload),
    ]);
  }

  private safeChecksum(book: OrderBook): string | null {
    try {
      return book.checksum();
    } catch {
      return null;
    }
  }
}
