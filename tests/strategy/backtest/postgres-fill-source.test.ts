import { describe, it, expect, vi } from 'vitest';
import { PostgresFillSource } from '../../../src/strategy/backtest/sources/postgres-fill-source';

describe('PostgresFillSource', () => {
  it('queries and yields tick events sorted by executed_at', async () => {
    const rows = [
      { id: '1', pair: 'p', side: 'buy', price: '100', qty: '1', executed_at: new Date('2026-04-01T00:00:00Z') },
      { id: '2', pair: 'p', side: 'sell', price: '101', qty: '0.5', executed_at: new Date('2026-04-01T00:01:00Z') },
    ];
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    const src = new PostgresFillSource({ pool: pool as any, pair: 'p', fromMs: 0, toMs: Date.parse('2026-05-01') });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]!.price).toBe(100);
    expect(events[1]!.price).toBe(101);
    expect(src.coverage()).toBe(1);
  });
});
