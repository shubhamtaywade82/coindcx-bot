import { describe, expect, it } from 'vitest';
import type { FusionSnapshot } from '../../src/marketdata/coindcx-fusion';
import {
  buildConfluenceReadout,
  formatConfluencePanelBlock,
  scoreConfluence,
} from '../../src/tui/confluence-signals';

/** Narrow fixture: only fields read by `scoreConfluence` / `buildConfluenceReadout` are guaranteed. */
function baseFusion(): FusionSnapshot {
  return {
    pair: 'B-TEST_USDT',
    l2: {
      pair: 'B-TEST_USDT',
      bestBid: 100,
      bestAsk: 100.1,
      spread: 0.1,
      bidDepth: 1,
      askDepth: 1,
      timestamp: 0,
    },
    ltp: {
      price: 100,
      bid: 100,
      ask: 100.1,
      markPrice: 100,
      volume24h: 0,
      change24h: 0,
    },
    candles: {},
    bookMetrics: {
      bidAskRatio: 1,
      bidWallPrice: null,
      bidWallSize: 0,
      askWallPrice: null,
      askWallSize: 0,
      imbalance: 'neutral',
    },
    candleMetrics: {
      trend1m: 'sideways',
      trend15m: 'sideways',
      volumeProfile: 'flat',
    },
    tradeMetrics: {
      pair: 'B-TEST_USDT',
      lastTradeTs: 0,
      cvd: 0,
      windows: {
        '60s': { windowMs: 60_000, trades: 0, buyVol: 0, sellVol: 0, totalVol: 0, delta: 0, imbalance: 0 },
        '300s': { windowMs: 300_000, trades: 0, buyVol: 0, sellVol: 0, totalVol: 0, delta: 0, imbalance: 0 },
      },
    },
    microstructure: {
      topNImbalance: {
        bidVolume: 1,
        askVolume: 1,
        imbalanceRatio: 1,
        imbalance: 'neutral',
      },
      cvd: { cvd: 0, shortWindowDelta: 0, longWindowDelta: 0 },
      aggressorRatio: { buyAggressiveVolume: 1, sellAggressiveVolume: 1, ratio: 1 },
      tapeSpeedAcceleration: { shortTrades: 0, longTrades: 0, shortTps: 0, longTps: 0, acceleration: 0 },
      sweep: { detected: false, side: 'none', burstTrades: 0, burstVolume: 0 },
      icebergSpoof: {
        icebergLikely: false,
        spoofLikely: false,
        consecutiveAbsorptions: 0,
        rapidBookFlips: 0,
      },
    },
    intraday: {
      anchoredVwap: { session: 0, daily: 0, swing: 0 },
      ttmSqueeze: { squeezeOn: false, breakout: 'none', bbWidth: 0, kcWidth: 0 },
      emaStack: { ema9: 0, ema21: 0, ema50: 0, alignment: 'mixed' },
      rsiDivergence: { rsi: 50, divergence: 'none', pricePivotDelta: 0, rsiPivotDelta: 0 },
      atrPercentileRank: { atr: 0, percentile: 0 },
      rollingOrderFlowImbalance: { value: 0, buyVolume: 0, sellVolume: 0, windowMs: 0, source: 'candle-fallback' },
    },
    swing: {
      marketStructureShift: {
        trend: 'range',
        mss: 'none',
        lastSwingHigh: 0,
        lastSwingLow: 0,
      },
      dailyWeeklyPivots: { daily: null, weekly: null },
      emaBiasFilter: { ema50: 0, ema200: 0, bias: 'neutral' },
      fundingRateExtremes: { extreme: 'none' },
      oiPriceTruthTable: { classification: 'neutral' },
      spotFuturesBasis: { state: 'unavailable' },
      btcDominanceCorrelationFilter: { isAlt: true, filter: 'allow', reason: '' },
    },
    generatedAt: 0,
  };
}

describe('confluence-signals', () => {
  it('formats waiting state when fusion is missing', () => {
    const block = formatConfluencePanelBlock('SOL', undefined);
    expect(block).toContain('not yet available');
    expect(block).toContain('SOL');
  });

  it('raises score on aligned bullish trends and MSS', () => {
    const f = baseFusion();
    f.candleMetrics.trend15m = 'up';
    f.candleMetrics.trend1m = 'up';
    f.swing.marketStructureShift = {
      trend: 'uptrend',
      mss: 'bullish',
      lastSwingHigh: 101,
      lastSwingLow: 99,
    };
    f.swing.emaBiasFilter.bias = 'bullish';
    f.intraday.emaStack.alignment = 'bullish';
    expect(scoreConfluence(f)).toBeGreaterThanOrEqual(6);
    expect(buildConfluenceReadout(f).headlinePlain).toMatch(/BULL|STRONG/);
  });

  it('scores buy-side raid reversal as bullish', () => {
    const f = baseFusion();
    f.liquidityRaid = {
      enabled: true,
      poolTimeframes: ['15m'],
      timeframe: '15m',
      pools: [],
      activeEvent: null,
      lastConfirmed: {
        poolId: 'p1',
        timeframe: '15m',
        side: 'buySide',
        poolPrice: 99,
        outcome: 'reversalCandidate',
        score: 5,
        atMs: 1,
        actionable: false,
        watchlistQuality: true,
      },
    };
    expect(scoreConfluence(f)).toBeGreaterThanOrEqual(2);
  });
});
