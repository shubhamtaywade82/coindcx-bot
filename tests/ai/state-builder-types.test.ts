import { describe, it, expect } from 'vitest';
import type { MarketState, MarketStateConfluence } from '../../src/ai/state-builder';

describe('MarketState type export', () => {
  it('compiles when MarketState is consumed at type level', () => {
    const m: MarketState = {
      htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
      ltf: {
        trend: 'uptrend', bos: false, swing_high: 1, swing_low: 0,
        displacement: { present: false, strength: 'weak' },
        fvg: [], mitigation: { status: 'untouched', zone: [0, 0] }, inducement: { present: false },
        premium_discount: 'equilibrium',
      },
      confluence: { aligned: true, narrative: 'x' },
      liquidity: { pools: [], event: 'none' },
      state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
    };
    expect(m.htf.trend).toBe('uptrend');
    const c: MarketStateConfluence = m.confluence;
    expect(c.aligned).toBe(true);
  });
});
