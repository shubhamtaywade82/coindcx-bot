import { describe, it, expect, vi } from 'vitest';
import { OrderStore } from '../../../src/account/stores/order-store';
import type { Order } from '../../../src/account/types';

const base: Order = {
  id: 'o1', pair: 'B-BTC_USDT', side: 'buy', type: 'limit', status: 'open',
  price: '50000', totalQty: '0.5', remainingQty: '0.5',
  createdAt: '2026-04-26T00:00:00Z', updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

describe('OrderStore', () => {
  it('upserts on applyWs', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500 });
    s.applyWs(base);
    expect(s.get('o1')?.status).toBe('open');
    s.applyWs({ ...base, status: 'partially_filled', remainingQty: '0.3' });
    expect(s.get('o1')?.status).toBe('partially_filled');
  });

  it('logs warn but accepts regression (filled -> open)', () => {
    const warn = vi.fn();
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500, onRegression: warn });
    s.applyWs({ ...base, status: 'filled' });
    s.applyWs({ ...base, status: 'open' });
    expect(warn).toHaveBeenCalledWith({ id: 'o1', from: 'filled', to: 'open' });
    expect(s.get('o1')?.status).toBe('open');
  });

  it('evicts closed orders past TTL', () => {
    let now = 1_000_000;
    const clock = () => now;
    const s = new OrderStore({ closedTtlMs: 1000, closedMax: 500, clock });
    s.applyWs({ ...base, status: 'filled', updatedAt: new Date(now).toISOString() });
    now += 2000;
    s.evictExpired();
    expect(s.get('o1')).toBeUndefined();
  });

  it('evicts oldest closed when over closedMax', () => {
    const fixedNow = new Date('2026-04-26T00:00:10Z').getTime();
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 2, clock: () => fixedNow });
    for (let i = 0; i < 5; i++) {
      s.applyWs({ ...base, id: `o${i}`, status: 'filled', updatedAt: `2026-04-26T00:00:0${i}Z` });
    }
    s.evictExpired();
    const ids = s.snapshot().map(o => o.id).sort();
    expect(ids.length).toBe(2);
    expect(ids).toEqual(['o3', 'o4']);
  });

  it('linkToPosition updates row', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500 });
    s.applyWs(base);
    s.linkToPosition('o1', 'pos1');
    expect(s.get('o1')?.positionId).toBe('pos1');
  });

  it('replaceFromRest replaces only open orders, preserves closed history window', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500 });
    s.applyWs({ ...base, id: 'oOpen' });
    s.applyWs({ ...base, id: 'oClosed', status: 'filled' });
    s.replaceFromRest([{ ...base, id: 'oNew' }]);
    expect(s.get('oOpen')).toBeUndefined();
    expect(s.get('oClosed')?.status).toBe('filled');
    expect(s.get('oNew')).toBeDefined();
  });
});
