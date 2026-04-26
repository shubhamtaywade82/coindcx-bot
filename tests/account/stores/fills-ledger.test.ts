import { describe, it, expect } from 'vitest';
import { FillsLedger } from '../../../src/account/stores/fills-ledger';
import type { Fill } from '../../../src/account/types';

const f1: Fill = {
  id: 'f1', pair: 'B-BTC_USDT', side: 'buy',
  price: '50000', qty: '0.1', realizedPnl: '0',
  executedAt: '2026-04-26T00:00:00Z', ingestedAt: '2026-04-26T00:00:01Z', source: 'ws',
};

describe('FillsLedger', () => {
  it('append is idempotent by id', () => {
    const l = new FillsLedger({ ringSize: 100 });
    expect(l.append(f1)).toBe(true);
    expect(l.append(f1)).toBe(false);
    expect(l.recent(10)).toHaveLength(1);
  });

  it('cursor advances to max executedAt seen', () => {
    const l = new FillsLedger({ ringSize: 100 });
    l.append({ ...f1, id: 'a', executedAt: '2026-04-26T00:00:00Z' });
    l.append({ ...f1, id: 'b', executedAt: '2026-04-26T01:00:00Z' });
    l.append({ ...f1, id: 'c', executedAt: '2026-04-26T00:30:00Z' });
    expect(l.cursor()).toBe('2026-04-26T01:00:00Z');
  });

  it('recent returns most recent N in chronological order', () => {
    const l = new FillsLedger({ ringSize: 100 });
    l.append({ ...f1, id: 'a', executedAt: '2026-04-26T00:00:00Z' });
    l.append({ ...f1, id: 'b', executedAt: '2026-04-26T00:01:00Z' });
    l.append({ ...f1, id: 'c', executedAt: '2026-04-26T00:02:00Z' });
    expect(l.recent(2).map(x => x.id)).toEqual(['b', 'c']);
  });

  it('ring evicts oldest when over capacity', () => {
    const l = new FillsLedger({ ringSize: 2 });
    l.append({ ...f1, id: 'a', executedAt: '2026-04-26T00:00:00Z' });
    l.append({ ...f1, id: 'b', executedAt: '2026-04-26T00:01:00Z' });
    l.append({ ...f1, id: 'c', executedAt: '2026-04-26T00:02:00Z' });
    expect(l.recent(10).map(x => x.id)).toEqual(['b', 'c']);
  });

  it('knownIds reflects ring contents', () => {
    const l = new FillsLedger({ ringSize: 2 });
    l.append({ ...f1, id: 'a' });
    l.append({ ...f1, id: 'b' });
    l.append({ ...f1, id: 'c' });
    expect(l.knownIds().has('a')).toBe(false);
    expect(l.knownIds().has('c')).toBe(true);
  });
});
