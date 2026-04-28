import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { TickDriver } from '../../../src/strategy/scheduler/tick-driver';

describe('TickDriver', () => {
  it('routes ws events to matching strategies', async () => {
    const ws = new EventEmitter();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new TickDriver({ ws: ws as any, runEvaluation: run, extractPair: (raw: any) => raw.pair });
    d.add({ id: 'a', pairs: ['B-BTC_USDT'], channels: ['new-trade'] });
    d.start();
    ws.emit('new-trade', { pair: 'B-BTC_USDT', price: 1 });
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledWith('a', 'B-BTC_USDT', expect.objectContaining({ kind: 'tick', channel: 'new-trade' }));
  });

  it('drops ticks for (strategy, pair) when previous still pending', async () => {
    const ws = new EventEmitter();
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const d = new TickDriver({ ws: ws as any, runEvaluation: run, extractPair: (raw: any) => raw.pair });
    d.add({ id: 'a', pairs: ['p'], channels: ['new-trade'] });
    d.start();
    ws.emit('new-trade', { pair: 'p' });
    ws.emit('new-trade', { pair: 'p' });
    ws.emit('new-trade', { pair: 'p' });
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.dropped('a', 'p')).toBe(2);
    resolve();
  });

  it('ignores pairs not in strategy manifest', async () => {
    const ws = new EventEmitter();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new TickDriver({ ws: ws as any, runEvaluation: run, extractPair: (raw: any) => raw.pair });
    d.add({ id: 'a', pairs: ['B-BTC_USDT'], channels: ['new-trade'] });
    d.start();
    ws.emit('new-trade', { pair: 'B-ETH_USDT' });
    await new Promise(r => setImmediate(r));
    expect(run).not.toHaveBeenCalled();
  });
});
