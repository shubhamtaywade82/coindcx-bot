import { describe, it, expect, vi } from 'vitest';
import { ContextBuilder } from '../../src/strategy/context-builder';
import type { Candle, MarketState } from '../../src/ai/state-builder';
import type { AccountSnapshot } from '../../src/account/types';

const fakeMarket: MarketState = {
  symbol: 'BTCUSDT',
  current_price: 1,
  htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
  ltf: { trend: 'uptrend', bos: false, swing_high: 1, swing_low: 0,
    displacement: { present: false, strength: 'weak' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0, 0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: 'x' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};
const fakeAccount: AccountSnapshot = {
  positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' },
};

describe('ContextBuilder', () => {
  it('composes context from sources', async () => {
    const buildState = vi.fn().mockResolvedValue(fakeMarket);
    const accountSnap = vi.fn().mockReturnValue(fakeAccount);
    const fillsRecent = vi.fn().mockReturnValue([]);
    const cb = new ContextBuilder({
      buildMarketState: buildState,
      candleProvider: { ltf: () => [] as Candle[], htf: () => [] as Candle[] },
      accountSnapshot: accountSnap,
      recentFills: fillsRecent,
      clock: () => 12345,
    });
    const ctx = await cb.build({ pair: 'B-BTC_USDT', trigger: { kind: 'interval' } });
    expect(ctx?.ts).toBe(12345);
    expect(ctx?.pair).toBe('B-BTC_USDT');
    expect(ctx?.marketState).toBe(fakeMarket);
    expect(ctx?.account).toBe(fakeAccount);
    expect(ctx?.trigger.kind).toBe('interval');
  });

  it('returns null when market state cannot be built', async () => {
    const cb = new ContextBuilder({
      buildMarketState: () => null,
      candleProvider: { ltf: () => [] as Candle[], htf: () => [] as Candle[] },
      accountSnapshot: () => fakeAccount,
      recentFills: () => [],
      clock: () => 1,
    });
    expect(await cb.build({ pair: 'X', trigger: { kind: 'interval' } })).toBeNull();
  });
});
