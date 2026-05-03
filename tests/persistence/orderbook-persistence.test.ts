import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { OrderbookPersistence } from '../../src/persistence/orderbook-persistence';

function mockPool(capture: unknown[][]): Pool {
  return {
    query: vi.fn(async (_sql: string, params: unknown[]) => {
      capture.push(params);
      return { rowCount: 1, rows: [], command: '', oid: 0, fields: [] };
    }),
  } as unknown as Pool;
}

describe('OrderbookPersistence', () => {
  it('stores null exchange_ts when payload yields NaN', async () => {
    const captured: unknown[][] = [];
    const persistence = new OrderbookPersistence(mockPool(captured));
    await persistence.persistArtifact({
      pair: 'B-BTC_USDT',
      channel: 'depth-snapshot',
      kind: 'ws_frame',
      ts: '2026-05-03T00:00:00.000Z',
      exchangeTs: Number(undefined),
      payload: {},
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]![4]).toBeNull();
  });

  it('truncates finite exchange_ts for bigint column', async () => {
    const captured: unknown[][] = [];
    const persistence = new OrderbookPersistence(mockPool(captured));
    await persistence.persistArtifact({
      pair: 'B-BTC_USDT',
      channel: 'depth-update',
      kind: 'ws_frame',
      ts: '2026-05-03T00:00:00.000Z',
      exchangeTs: 1_700_000_000_123.9,
      payload: {},
    });
    expect(captured[0]![4]).toBe(1_700_000_000_123);
  });
});
