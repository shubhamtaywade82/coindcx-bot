import { describe, expect, it, vi } from 'vitest';
import { TradePersistence } from '../../src/persistence/trade-persistence';

describe('TradePersistence', () => {
  it('inserts trades with idempotent conflict handling', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [] }));
    const persistence = new TradePersistence({ query } as any);
    await persistence.persist({
      id: 'trade-1',
      ts: '2026-05-03T12:00:00.000Z',
      pair: 'B-BTC_USDT',
      side: 'TAKER',
      price: '100',
      qty: '2',
      source: 'ws.new-trade',
      payload: { raw: true },
    });
    expect(query).toHaveBeenCalledTimes(1);
    const firstCall = query.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const sql = firstCall[0];
    const params = firstCall[1];
    expect(sql).toMatch(/INSERT INTO trades/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(params[0]).toBe('trade-1');
    expect(params[2]).toBe('B-BTC_USDT');
  });
});
