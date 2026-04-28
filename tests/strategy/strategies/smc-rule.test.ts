import { describe, it, expect } from 'vitest';
import { SmcRule } from '../../../src/strategy/strategies/smc-rule';
import type { StrategyContext } from '../../../src/strategy/types';
import type { MarketState } from '../../../src/ai/state-builder';
import type { AccountSnapshot } from '../../../src/account/types';

const account: AccountSnapshot = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

function ctx(market: MarketState): StrategyContext {
  return {
    ts: 1, pair: 'B-BTC_USDT', marketState: market,
    account, recentFills: [], trigger: { kind: 'interval' },
  };
}

const baseUp: MarketState = {
  htf: { trend: 'uptrend', swing_high: 50000, swing_low: 48000 },
  ltf: { trend: 'uptrend', bos: true, swing_high: 50500, swing_low: 49500,
    displacement: { present: true, strength: 'strong' },
    fvg: [{ type: 'bullish', gap: [49800, 49900], filled: false }],
    mitigation: { status: 'untouched', zone: [0, 0] }, inducement: { present: false },
    premium_discount: 'discount' },
  confluence: { aligned: true, narrative: 'aligned uptrend' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: true },
};

describe('SmcRule', () => {
  it('returns LONG on aligned uptrend with BOS + displacement + bullish FVG', async () => {
    const s = new SmcRule();
    const r = await s.evaluate(ctx(baseUp));
    expect(r?.side).toBe('LONG');
    expect(r?.confidence).toBeGreaterThan(0.5);
    expect(r?.entry).toBeDefined();
  });

  it('returns SHORT on aligned downtrend mirror conditions', async () => {
    const s = new SmcRule();
    const downtrend: MarketState = {
      ...baseUp,
      htf: { trend: 'downtrend', swing_high: 50000, swing_low: 48000 },
      ltf: { ...baseUp.ltf, trend: 'downtrend',
        fvg: [{ type: 'bearish', gap: [49900, 50000], filled: false }],
        premium_discount: 'premium' },
      confluence: { aligned: true, narrative: 'aligned downtrend' },
    };
    const r = await s.evaluate(ctx(downtrend));
    expect(r?.side).toBe('SHORT');
  });

  it('returns WAIT when HTF and LTF disagree', async () => {
    const s = new SmcRule();
    const conflict: MarketState = {
      ...baseUp,
      htf: { trend: 'downtrend', swing_high: 50000, swing_low: 48000 },
      confluence: { aligned: false, narrative: 'conflict' },
    };
    const r = await s.evaluate(ctx(conflict));
    expect(r?.side).toBe('WAIT');
    expect(r?.noTradeCondition).toMatch(/confluence/i);
  });

  it('returns WAIT without displacement', async () => {
    const s = new SmcRule();
    const noDisp: MarketState = {
      ...baseUp,
      ltf: { ...baseUp.ltf, displacement: { present: false, strength: 'weak' } },
    };
    const r = await s.evaluate(ctx(noDisp));
    expect(r?.side).toBe('WAIT');
  });

  it('manifest declares interval mode and 50 warmup candles', () => {
    const s = new SmcRule();
    expect(s.manifest.id).toBe('smc.rule.v1');
    expect(s.manifest.mode).toBe('interval');
    expect(s.manifest.warmupCandles).toBe(50);
  });
});
