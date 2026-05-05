import { describe, expect, it, vi } from 'vitest';
import { CandleHistoryPersistence } from '../../src/persistence/candle-history-persistence';

describe('CandleHistoryPersistence', () => {
  it('upserts candles into candles table', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [] }));
    const persistence = new CandleHistoryPersistence({ query } as any);
    const persisted = await persistence.persistMany({
      pair: 'B-BTC_USDT',
      timeframe: '1m',
      source: 'test.source',
      candles: [
        {
          openTimeMs: 1_000,
          closeTimeMs: 61_000,
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 12,
        },
      ],
    });

    expect(persisted).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO candles/);
    expect(params).toEqual(expect.arrayContaining(['B-BTC_USDT', '1m', 1_000, 61_000, 'test.source']));
  });
});
