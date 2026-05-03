import { describe, it, expect } from 'vitest';
import { BearishSmc } from '../../../src/strategy/strategies/bearish-smc';
import type { StrategyContext } from '../../../src/strategy/types';
import type { MarketState } from '../../../src/ai/state-builder';
import type { AccountSnapshot } from '../../../src/account/types';

const account: AccountSnapshot = {
  positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' },
};

function ctx(market: Partial<MarketState>): StrategyContext {
  return {
    ts: 1,
    pair: 'B-BTC_USDT',
    marketState: market as MarketState,
    account,
    recentFills: [],
    trigger: { kind: 'interval' },
  };
}

// ── Base fixture: CHOCH setup (model 1 — break block reversal) ────────────────
// HTF uptrend + LTF bearish BOS + sweep + strong displacement
// Price: 49_500, swing_high: 50_500, swing_low: 48_000
// risk  = 50_500*1.001 - 49_500 = 50_550.5 - 49_500 = 1_050.5
// reward= 49_500 - 48_000*0.999 = 49_500 - 47_952 = 1_548
// RR    = 1_548 / 1_050.5 ≈ 1.47  → too low without FVG, needs FVG or we'll see wait
// With FVG at [50_000, 50_200]: entry = 50_100
// risk  = 50_550.5 - 50_100 = 450.5
// reward= 50_100 - 47_952 = 2_148
// RR    = 2_148 / 450.5 ≈ 4.77  ✓
const baseChoch: MarketState = {
  symbol: 'B-BTC_USDT',
  current_price: 49_500,
  htf: { trend: 'uptrend', swing_high: 52_000, swing_low: 46_000 },
  ltf: {
    trend: 'downtrend',          // LTF bearish BOS (close-based)
    bos: true,
    swing_high: 50_500,
    swing_low:  48_000,
    displacement: { present: true, strength: 'strong' },
    fvg: [{ type: 'bearish', gap: [50_000, 50_200], filled: false }],
    mitigation: { status: 'untouched', zone: [0, 0] },
    inducement: { present: false },
    premium_discount: 'premium',
  },
  confluence: { aligned: false, narrative: 'CHOCH' },
  liquidity: { pools: [], event: 'sweep' },
  state: { is_trending: true, is_post_sweep: true, is_pre_expansion: true },
};

// ── Base fixture: OB retest (model 2) ────────────────────────────────────────
// HTF downtrend + LTF downtrend + displacement — no sweep required
// entry = FVG midpoint 50_100, sl = 50_500*1.001 = 50_550.5, tp = 48_000*0.999 = 47_952
const baseObRetest: MarketState = {
  ...baseChoch,
  htf: { trend: 'downtrend', swing_high: 52_000, swing_low: 46_000 },
  state: { ...baseChoch.state, is_post_sweep: false },
};

// ── Base fixture: Supply retest (model 3) ────────────────────────────────────
// HTF downtrend + premium zone, no displacement yet
// Without FVG: entry = current_price 50_100
// sl = 50_500*1.001 = 50_550.5, tp = 48_000*0.999 = 47_952
// risk = 450.5, reward = 2_148, RR ≈ 4.77  ✓
// Confidence: 0.30 (base) + 0.20 (sweep) + 0.08 (htf cont) + 0.05 (premium) = 0.63 >= 0.50 ✓
const baseSupplyRetest: MarketState = {
  ...baseChoch,
  current_price: 50_100,
  htf: { trend: 'downtrend', swing_high: 52_000, swing_low: 46_000 },
  ltf: {
    ...baseChoch.ltf,
    displacement: { present: false, strength: 'weak' }, // no displacement yet
    fvg: [],
    premium_discount: 'premium',
  },
  state: { is_trending: true, is_post_sweep: true, is_pre_expansion: false },
};

describe('BearishSmc', () => {
  // ── Manifest ──────────────────────────────────────────────────────────────
  it('has correct manifest id, mode, and warmup', () => {
    const s = new BearishSmc();
    expect(s.manifest.id).toBe('bearish.smc.v1');
    expect(s.manifest.mode).toBe('interval');
    expect(s.manifest.warmupCandles).toBe(50);
    expect(s.manifest.pairs).toContain('*');
  });

  it('clone() produces an independent instance with same manifest', () => {
    const s = new BearishSmc();
    const c = s.clone();
    expect(c).not.toBe(s);
    expect(c.manifest.id).toBe(s.manifest.id);
  });

  // ── Model 1: Break Block Reversal (CHOCH) ─────────────────────────────────
  it('signals SHORT on CHOCH + sweep + strong displacement (break block reversal)', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(r.side).toBe('SHORT');
    expect(r.meta?.model).toBe('break_block_reversal');
    expect(r.confidence).toBeGreaterThanOrEqual(0.60);
    expect(r.entry).toBeDefined();
    expect(r.stopLoss).toBeDefined();
    expect(r.takeProfit).toBeDefined();
  });

  it('entry uses bearish FVG midpoint when FVG is available', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    // FVG gap [50_000, 50_200] → midpoint 50_100
    expect(parseFloat(r.entry!)).toBeCloseTo(50_100, 0);
  });

  it('reason mentions the model name and CHOCH label', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(r.reason).toMatch(/break block reversal/i);
    expect(r.reason).toMatch(/CHOCH/i);
  });

  it('RR is included in the reason string', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(r.reason).toMatch(/RR \d+\.\d+:1/);
  });

  it('meta carries all expected keys', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(r.meta).toMatchObject({
      model: 'break_block_reversal',
      htfTrend: 'uptrend',
      ltfTrend: 'downtrend',
      postSweep: true,
      atPremium: true,
      hasBearishFvg: true,
    });
    expect(typeof r.meta?.rr).toBe('number');
  });

  // ── Model 2: OB Retest ────────────────────────────────────────────────────
  it('signals SHORT on HTF downtrend + LTF BOS + displacement (OB retest)', () => {
    const r = new BearishSmc().evaluate(ctx(baseObRetest));
    expect(r.side).toBe('SHORT');
    expect(r.meta?.model).toBe('ob_retest');
    expect(r.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it('OB retest does NOT require is_post_sweep', () => {
    const noSweep: MarketState = { ...baseObRetest, state: { ...baseObRetest.state, is_post_sweep: false } };
    const r = new BearishSmc().evaluate(ctx(noSweep));
    expect(r.side).toBe('SHORT');
    expect(r.meta?.model).toBe('ob_retest');
  });

  it('OB retest confidence is lower than break block reversal on identical market with different HTF', () => {
    const choch = new BearishSmc().evaluate(ctx(baseChoch));
    const ob    = new BearishSmc().evaluate(ctx(baseObRetest));
    // CHOCH with sweep gets the sweep bonus on top of higher base
    expect(choch.confidence).toBeGreaterThanOrEqual(ob.confidence);
  });

  // ── Model 3: Supply Retest ────────────────────────────────────────────────
  it('signals SHORT on HTF downtrend + premium zone + sweep (supply retest)', () => {
    const r = new BearishSmc().evaluate(ctx(baseSupplyRetest));
    expect(r.side).toBe('SHORT');
    expect(r.meta?.model).toBe('supply_retest');
  });

  it('supply retest uses current price as entry when no FVG is present', () => {
    const r = new BearishSmc().evaluate(ctx(baseSupplyRetest));
    expect(parseFloat(r.entry!)).toBeCloseTo(baseSupplyRetest.current_price, 0);
  });

  it('supply retest WAITs when there is no sweep and no book confirmation (low confidence)', () => {
    const low: MarketState = {
      ...baseSupplyRetest,
      state: { ...baseSupplyRetest.state, is_post_sweep: false },
      // no book field → no ask-heavy bonus
    };
    const r = new BearishSmc().evaluate(ctx(low));
    // base 0.30 + htf 0.08 + premium 0.05 = 0.43 < 0.50 minimum
    expect(r.side).toBe('WAIT');
    expect(r.noTradeCondition).toMatch(/confidence/i);
  });

  it('supply retest signals SHORT when ask-heavy book + excellent RR push confidence over gate', () => {
    // No sweep, but: base 0.30 + htf 0.08 + premium 0.05 + book 0.05 + RR>3 bonus 0.04 = 0.52 >= 0.50
    // entry=50_100, sl=50_550.5, tp=47_952 → RR≈4.77 qualifies for the RR bonus
    const withBook: MarketState = {
      ...baseSupplyRetest,
      state: { ...baseSupplyRetest.state, is_post_sweep: false },
      book: { bestBid: 50_090, bestAsk: 50_100, spread: 10, bidDepth1pct: 100, askDepth1pct: 160,
               imbalance: 'ask-heavy', bidWallPrice: null, askWallPrice: null },
    };
    const r = new BearishSmc().evaluate(ctx(withBook));
    expect(r.side).toBe('SHORT');
    expect(r.meta?.model).toBe('supply_retest');
    expect(r.confidence).toBeGreaterThanOrEqual(0.50);
  });

  it('supply retest WAITs when no sweep and neutral book (RR bonus alone not enough)', () => {
    // base 0.30 + htf 0.08 + premium 0.05 + RR>3 bonus 0.04 = 0.47 < 0.50 → WAIT
    const noBookNoSweep: MarketState = {
      ...baseSupplyRetest,
      state: { ...baseSupplyRetest.state, is_post_sweep: false },
    };
    const r = new BearishSmc().evaluate(ctx(noBookNoSweep));
    expect(r.side).toBe('WAIT');
    expect(r.noTradeCondition).toMatch(/confidence/i);
  });

  // ── WAIT conditions ───────────────────────────────────────────────────────
  it('WAITs when HTF is ranging (not bearish)', () => {
    const ranging: MarketState = {
      ...baseChoch,
      htf: { trend: 'range', swing_high: 52_000, swing_low: 46_000 },
    };
    const r = new BearishSmc().evaluate(ctx(ranging));
    expect(r.side).toBe('WAIT');
    expect(r.reason).toMatch(/HTF/i);
  });

  it('WAITs when HTF is downtrend but LTF is uptrend (no BOS, no premium)', () => {
    const ltfUp: MarketState = {
      ...baseChoch,
      htf: { trend: 'downtrend', swing_high: 52_000, swing_low: 46_000 },
      ltf: { ...baseChoch.ltf, trend: 'uptrend', displacement: { present: false, strength: 'weak' }, premium_discount: 'discount' },
    };
    const r = new BearishSmc().evaluate(ctx(ltfUp));
    expect(r.side).toBe('WAIT');
  });

  it('WAITs when CHOCH is present but no sweep (break block reversal requires sweep)', () => {
    const noSweep: MarketState = {
      ...baseChoch,
      htf: { trend: 'uptrend', swing_high: 52_000, swing_low: 46_000 },
      state: { ...baseChoch.state, is_post_sweep: false },
    };
    // isChoch true but no sweep → fails model 1 condition
    // isContinuation false (HTF uptrend) → cannot fall through to model 2 or 3
    const r = new BearishSmc().evaluate(ctx(noSweep));
    expect(r.side).toBe('WAIT');
  });

  it('WAITs when R:R is below 1.5 (swing_low too close to entry)', () => {
    // swing_low close to current price → tiny reward
    const tightTp: MarketState = {
      ...baseChoch,
      ltf: { ...baseChoch.ltf, swing_low: 50_000 }, // almost at entry (FVG mid = 50_100)
    };
    // entry = 50_100, sl = 50_500*1.001 = 50_550.5, tp = 50_000*0.999 = 49_950
    // risk = 450.5, reward = 50_100 - 49_950 = 150 → RR = 0.33 < 1.5
    const r = new BearishSmc().evaluate(ctx(tightTp));
    expect(r.side).toBe('WAIT');
    expect(r.reason).toMatch(/R:R/);
  });

  it('WAITs when swing levels are zero (candles not yet established)', () => {
    const noLevels: MarketState = {
      ...baseChoch,
      ltf: { ...baseChoch.ltf, swing_high: 0, swing_low: 0 },
    };
    const r = new BearishSmc().evaluate(ctx(noLevels));
    expect(r.side).toBe('WAIT');
    expect(r.reason).toMatch(/swing levels/i);
  });

  it('WAITs when geometry is invalid (FVG midpoint above swing_high)', () => {
    // FVG sits above the swing_high — midpoint would be above SL
    const badFvg: MarketState = {
      ...baseChoch,
      ltf: {
        ...baseChoch.ltf,
        fvg: [{ type: 'bearish', gap: [50_600, 50_800], filled: false }],
      },
    };
    // entry = 50_700, sl = 50_500*1.001 = 50_550.5 → entry > sl → invalid
    const r = new BearishSmc().evaluate(ctx(badFvg));
    expect(r.side).toBe('WAIT');
    expect(r.reason).toMatch(/geometry/i);
  });

  // ── Confidence scoring ────────────────────────────────────────────────────
  it('ask-heavy book increases confidence', () => {
    const noBook = new BearishSmc().evaluate(ctx(baseChoch));
    const withBook = new BearishSmc().evaluate(ctx({
      ...baseChoch,
      book: { bestBid: 50_090, bestAsk: 50_100, spread: 10, bidDepth1pct: 100, askDepth1pct: 160,
               imbalance: 'ask-heavy', bidWallPrice: null, askWallPrice: null },
    }));
    expect(withBook.confidence).toBeGreaterThan(noBook.confidence);
  });

  it('strong displacement scores higher than weak displacement', () => {
    const strong = new BearishSmc().evaluate(ctx(baseChoch)); // strength: 'strong'
    const weak   = new BearishSmc().evaluate(ctx({
      ...baseChoch,
      ltf: { ...baseChoch.ltf, displacement: { present: true, strength: 'weak' } },
    }));
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('confidence is capped at 1.0 even with all bonuses', () => {
    const maxed: MarketState = {
      ...baseChoch,
      ltf: { ...baseChoch.ltf, displacement: { present: true, strength: 'strong' } },
      state: { ...baseChoch.state, is_post_sweep: true },
      book: { bestBid: 50_090, bestAsk: 50_100, spread: 10, bidDepth1pct: 100, askDepth1pct: 200,
               imbalance: 'ask-heavy', bidWallPrice: null, askWallPrice: null },
    };
    const r = new BearishSmc().evaluate(ctx(maxed));
    expect(r.confidence).toBeLessThanOrEqual(1.0);
  });

  // ── Levels arithmetic ─────────────────────────────────────────────────────
  it('stopLoss is above entry for a SHORT', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(parseFloat(r.stopLoss!)).toBeGreaterThan(parseFloat(r.entry!));
  });

  it('takeProfit is below entry for a SHORT', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(parseFloat(r.takeProfit!)).toBeLessThan(parseFloat(r.entry!));
  });

  it('stopLoss is 0.1% above ltf.swing_high', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(parseFloat(r.stopLoss!)).toBeCloseTo(baseChoch.ltf.swing_high * 1.001, 1);
  });

  it('takeProfit is 0.1% below ltf.swing_low', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(parseFloat(r.takeProfit!)).toBeCloseTo(baseChoch.ltf.swing_low * 0.999, 1);
  });

  it('ttlMs is 10 minutes', () => {
    const r = new BearishSmc().evaluate(ctx(baseChoch));
    expect(r.ttlMs).toBe(10 * 60_000);
  });
});
