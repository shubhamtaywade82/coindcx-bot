import { describe, expect, it } from 'vitest';
import type { Candle } from '../../../src/ai/state-builder';
import { LiquidityEngine } from '../../../src/marketdata/liquidity/liquidity-engine';
import type { LiquidityEngineConfig, LiquidityEngineStepInput } from '../../../src/marketdata/liquidity/types';
import type { SwingIndicators } from '../../../src/marketdata/swing-indicators';

const PAIR = 'B-BTC_USDT';
const START_TS = 1_700_000_000_000;
const BAR_MS = 60_000;

const baseConfig: LiquidityEngineConfig = {
  enabled: true,
  poolTimeframes: ['1m'],
  lookbackBars: 80,
  equalClusterFloorPct: 0.2,
  equalClusterAtrMult: 0.25,
  poolStrengthDecay: 0.95,
  maxPoolsPerPair: 12,
  minPenetrationPct: 0.05,
  maxPenetrationPct: 0.4,
  penetrationAtrScale: 1,
  velocityWindowMs: 800,
  velocityMinPctPerSec: 0.1,
  volumeSpikeMult: 1.5,
  volumeLookbackBars: 10,
  maxRejectionBars: 5,
  acceptanceHoldBars: 2,
  eventMaxAgeMs: 3_600_000,
  eventMaxBarsSinceSweep: 8,
  actionableScoreMin: 8,
  watchlistScoreMin: 5,
  structureMssBonus: true,
};

const bearishSwing = {
  marketStructureShift: { trend: 'range' as const, mss: 'bearish' as const, lastSwingHigh: 0, lastSwingLow: 0 },
  dailyWeeklyPivots: { daily: null, weekly: null },
  emaBiasFilter: { ema50: 0, ema200: 0, bias: 'neutral' as const },
  fundingRateExtremes: { extreme: 'none' as const },
  oiPriceTruthTable: { classification: 'neutral' as const },
  spotFuturesBasis: { state: 'flat' as const },
  btcDominanceCorrelationFilter: { isAlt: false, filter: 'allow' as const, reason: '' },
} satisfies SwingIndicators;

const bullishSwing = {
  ...bearishSwing,
  marketStructureShift: { trend: 'range' as const, mss: 'bullish' as const, lastSwingHigh: 0, lastSwingLow: 0 },
} satisfies SwingIndicators;

function candle(index: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  return {
    timestamp: START_TS + index * BAR_MS,
    open,
    high,
    low,
    close,
    volume,
  };
}

function buySideClosedCandles(lastVolume = 220): Candle[] {
  return Array.from({ length: 30 }, (_, index) => {
    const volume = index === 29 ? lastVolume : 100;
    if (index === 8 || index === 14) return candle(index, 98.8, 100, 98.4, 99.2, volume);
    return candle(index, 98.6, 99.1, 98, 98.7, volume);
  });
}

function sellSideClosedCandles(lastVolume = 220): Candle[] {
  return Array.from({ length: 30 }, (_, index) => {
    const volume = index === 29 ? lastVolume : 100;
    if (index === 8 || index === 14) return candle(index, 101.2, 101.6, 100, 100.8, volume);
    return candle(index, 101.3, 102, 100.9, 101.4, volume);
  });
}

function withForming(closed: Candle[], index = closed.length): Candle[] {
  return [...closed, candle(index, 99, 99.2, 98.8, 99, 50)];
}

function bearishDisplacementCandles(): Candle[] {
  const closed = Array.from({ length: 10 }, (_, index) => candle(index, 100, 100.1, 99.9, 100.04));
  closed.push(candle(10, 100.1, 100.2, 99.5, 99.55));
  return withForming(closed, 11);
}

function bullishDisplacementCandles(): Candle[] {
  const closed = Array.from({ length: 10 }, (_, index) => candle(index, 100, 100.1, 99.9, 99.96));
  closed.push(candle(10, 99.9, 100.5, 99.8, 100.45));
  return withForming(closed, 11);
}

function stepInput(
  poolCandles: Candle[],
  price: number,
  nowMs: number,
  overrides: Partial<LiquidityEngineStepInput> = {},
): LiquidityEngineStepInput {
  return {
    pair: PAIR,
    poolCandlesByTf: { '1m': poolCandles },
    ltf1mCandles: [],
    bestBid: price,
    bestAsk: price,
    ltpPrice: price,
    lastTradePrice: price,
    swing: bearishSwing,
    nowMs,
    ...overrides,
  };
}

function stepInputMulti(
  poolCandlesByTf: Record<string, Candle[]>,
  price: number,
  nowMs: number,
  overrides: Partial<LiquidityEngineStepInput> = {},
): LiquidityEngineStepInput {
  return {
    pair: PAIR,
    poolCandlesByTf,
    ltf1mCandles: [],
    bestBid: price,
    bestAsk: price,
    ltpPrice: price,
    lastTradePrice: price,
    swing: bearishSwing,
    nowMs,
    ...overrides,
  };
}

describe('LiquidityEngine', () => {
  it('discovers pools on each configured pool timeframe', () => {
    const engine = new LiquidityEngine({ ...baseConfig, poolTimeframes: ['1m', '5m'] });
    const candles = withForming(buySideClosedCandles());
    const snapshot = engine.step(stepInputMulti({ '1m': candles, '5m': candles }, 99.5, START_TS));
    const timeframes = new Set(snapshot?.pools.map(p => p.timeframe));
    expect(timeframes.has('1m')).toBe(true);
    expect(timeframes.has('5m')).toBe(true);
  });

  it('keeps a touched buy-side raid active without emitting a confirmed signal', () => {
    const engine = new LiquidityEngine(baseConfig);
    const candles = withForming(buySideClosedCandles());

    engine.step(stepInput(candles, 99.8, START_TS));
    const snapshot = engine.step(stepInput(candles, 100, START_TS + 100));

    expect(snapshot?.activeEvent?.state).toBe('touched');
    expect(snapshot?.activeEvent?.side).toBe('buySide');
    expect(snapshot?.lastConfirmed).toBeNull();
  });

  it('keeps penetration without volume spike in touched state', () => {
    const engine = new LiquidityEngine(baseConfig);
    const candles = withForming(buySideClosedCandles(100));

    engine.step(stepInput(candles, 99.8, START_TS));
    engine.step(stepInput(candles, 100, START_TS + 100));
    const snapshot = engine.step(stepInput(candles, 100.18, START_TS + 700));

    expect(snapshot?.activeEvent?.state).toBe('touched');
    expect(snapshot?.lastConfirmed).toBeNull();
  });

  it('confirms a buy-side reversal candidate after sweep, rejection, and opposite displacement', () => {
    const engine = new LiquidityEngine(baseConfig);
    const closed = buySideClosedCandles();
    const candles = withForming(closed);

    engine.step(stepInput(candles, 99.8, START_TS));
    engine.step(stepInput(candles, 100, START_TS + 100));
    engine.step(stepInput(candles, 100.18, START_TS + 700));

    const rejected = [...closed, candle(30, 100.12, 100.25, 99.7, 99.85, 230)];
    const snapshot = engine.step(
      stepInput(withForming(rejected, 31), 99.85, START_TS + BAR_MS, {
        ltf1mCandles: bearishDisplacementCandles(),
      }),
    );

    expect(snapshot?.lastConfirmed?.outcome).toBe('reversalCandidate');
    expect(snapshot?.lastConfirmed?.side).toBe('buySide');
    expect(snapshot?.lastConfirmed?.score ?? 0).toBeGreaterThanOrEqual(baseConfig.watchlistScoreMin);
  });

  it('drops an accepted buy-side raid as a breakout continuation', () => {
    const engine = new LiquidityEngine(baseConfig);
    const closed = buySideClosedCandles();
    const candles = withForming(closed);

    engine.step(stepInput(candles, 99.8, START_TS));
    engine.step(stepInput(candles, 100, START_TS + 100));
    engine.step(stepInput(candles, 100.18, START_TS + 700));

    const firstAccepted = [...closed, candle(30, 100.05, 100.3, 99.9, 100.15, 230)];
    engine.step(stepInput(withForming(firstAccepted, 31), 100.15, START_TS + BAR_MS));

    const secondAccepted = [...firstAccepted, candle(31, 100.1, 100.35, 99.95, 100.2, 230)];
    const snapshot = engine.step(stepInput(withForming(secondAccepted, 32), 100.2, START_TS + BAR_MS * 2));

    expect(snapshot?.activeEvent).toBeNull();
    expect(snapshot?.lastConfirmed).toBeNull();
  });

  it('preserves pool touches across refreshes', () => {
    const engine = new LiquidityEngine(baseConfig);
    const closed = buySideClosedCandles();
    const candles = withForming(closed);

    engine.step(stepInput(candles, 99.8, START_TS));
    const touched = engine.step(stepInput(candles, 100, START_TS + 100));
    const poolId = touched?.activeEvent?.poolId;

    const refreshedClosed = [...closed, candle(30, 98.7, 99.1, 98.1, 98.8, 100)];
    const refreshed = engine.step(stepInput(withForming(refreshedClosed, 31), 99.8, START_TS + BAR_MS));

    expect(refreshed?.pools[0]?.id).toBe(poolId);
    expect(refreshed?.pools[0]?.touches ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('confirms a sell-side reversal candidate after sweep, rejection, and opposite displacement', () => {
    const engine = new LiquidityEngine(baseConfig);
    const closed = sellSideClosedCandles();
    const candles = withForming(closed);

    engine.step(stepInput(candles, 100.2, START_TS, { swing: bullishSwing }));
    engine.step(stepInput(candles, 100, START_TS + 100, { swing: bullishSwing }));
    engine.step(stepInput(candles, 99.82, START_TS + 700, { swing: bullishSwing }));

    const rejected = [...closed, candle(30, 99.9, 100.3, 99.75, 100.15, 230)];
    const snapshot = engine.step(
      stepInput(withForming(rejected, 31), 100.15, START_TS + BAR_MS, {
        ltf1mCandles: bullishDisplacementCandles(),
        swing: bullishSwing,
      }),
    );

    expect(snapshot?.lastConfirmed?.outcome).toBe('reversalCandidate');
    expect(snapshot?.lastConfirmed?.side).toBe('sellSide');
    expect(snapshot?.lastConfirmed?.score ?? 0).toBeGreaterThanOrEqual(baseConfig.watchlistScoreMin);
  });
});
