import { describe, it, expect } from 'vitest';
import { MaCross } from '../../../src/strategy/strategies/ma-cross';
import type { StrategyContext } from '../../../src/strategy/types';
import type { Candle } from '../../../src/ai/state-builder';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ timestamp: i * 60_000, open: c, high: c, low: c, close: c, volume: 1 }));
}

const account = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

const market = (swingHigh: number) => ({
  htf: { trend: 'uptrend', swing_high: swingHigh, swing_low: swingHigh * 0.9 },
  ltf: { trend: 'uptrend', bos: false, swing_high: swingHigh, swing_low: swingHigh * 0.9,
    displacement: { present: false, strength: 'weak' as const }, fvg: [],
    mitigation: { status: 'untouched', zone: [0, 0] as [number, number] }, inducement: { present: false },
    premium_discount: 'equilibrium' as const },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
});

const ctxAt = (h: number): StrategyContext => ({
  ts: 1, pair: 'p', marketState: market(h) as any,
  account: account as any, recentFills: [], trigger: { kind: 'bar_close', tf: '1m' },
});

describe('MaCross', () => {
  it('emits LONG on golden cross', async () => {
    const s = new MaCross();
    await s.warmup({ pair: 'p', candles: makeCandles([
      ...Array(30).fill(100), ...Array(20).fill(80),
    ]) });
    const r = await s.evaluate(ctxAt(200));
    expect(r?.side).toBe('LONG');
  });

  it('emits SHORT on death cross', async () => {
    const s = new MaCross();
    await s.warmup({ pair: 'p', candles: makeCandles([
      ...Array(30).fill(100), ...Array(20).fill(120),
    ]) });
    const r = await s.evaluate(ctxAt(20));
    expect(r?.side).toBe('SHORT');
  });

  it('emits WAIT in consolidation', async () => {
    const s = new MaCross();
    await s.warmup({ pair: 'p', candles: makeCandles(Array(50).fill(100)) });
    const r = await s.evaluate(ctxAt(100));
    expect(r?.side).toBe('WAIT');
  });
});
