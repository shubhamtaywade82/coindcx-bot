import { describe, it, expect, vi } from 'vitest';
import { CandleSource } from '../../../src/strategy/backtest/sources/candle-source';

describe('CandleSource', () => {
  it('yields one bar_close per candle and zero gaps when complete', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ts: 0, o: 1, h: 2, l: 0, c: 1.5 },
      { ts: 60_000, o: 1.5, h: 2.5, l: 1.4, c: 2 },
    ]);
    const src = new CandleSource({ pair: 'p', tf: '1m', fromMs: 0, toMs: 120_000, fetcher });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    expect(events.filter(e => e.kind === 'bar_close')).toHaveLength(2);
    expect(events.filter(e => e.kind === 'gap')).toHaveLength(0);
    expect(src.coverage()).toBe(1);
  });

  it('emits gap for missing bars and reports coverage <1', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ts: 0, o: 1, h: 2, l: 0, c: 1 },
      { ts: 120_000, o: 1, h: 2, l: 0, c: 1 },
    ]);
    const src = new CandleSource({ pair: 'p', tf: '1m', fromMs: 0, toMs: 180_000, fetcher });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    const gaps = events.filter(e => e.kind === 'gap');
    expect(gaps.length).toBeGreaterThan(0);
    expect(src.coverage()).toBeLessThan(1);
  });
});
