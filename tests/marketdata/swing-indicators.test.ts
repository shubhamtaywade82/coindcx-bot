import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/ai/state-builder';
import type { SwingHistoryPoint } from '../../src/marketdata/swing-indicators';
import { computeSwingIndicators } from '../../src/marketdata/swing-indicators';

function candle(ts: number, open: number, high: number, low: number, close: number, volume = 10): Candle {
  return { timestamp: ts, open, high, low, close, volume };
}

describe('computeSwingIndicators', () => {
  it('computes market structure shift, pivots, and EMA bias filter', () => {
    const now = 10_000_000;
    const candles1h: Candle[] = [
      candle(now - 11 * 3_600_000, 95, 96, 94, 95.5),
      candle(now - 10 * 3_600_000, 95.5, 97, 95, 96.8),
      candle(now - 9 * 3_600_000, 96.8, 98, 96.2, 97.6),
      candle(now - 8 * 3_600_000, 97.6, 99, 97.1, 98.7),
      candle(now - 7 * 3_600_000, 98.7, 101, 98.2, 100.5),
      candle(now - 6 * 3_600_000, 100.5, 102, 100.1, 101.8),
      candle(now - 5 * 3_600_000, 101.8, 103, 101.3, 102.4),
      candle(now - 4 * 3_600_000, 102.4, 104, 102, 103.2),
      candle(now - 3 * 3_600_000, 103.2, 105, 102.9, 104.4),
      candle(now - 2 * 3_600_000, 104.4, 106, 104.1, 105.2),
      candle(now - 3_600_000, 105.2, 107, 104.9, 106.4),
      candle(now, 106.4, 108.2, 106, 107.8),
    ];

    const historyByPair = new Map<string, SwingHistoryPoint[]>([
      ['B-ETH_USDT', []],
      ['B-BTC_USDT', []],
    ]);

    const out = computeSwingIndicators({
      pair: 'B-ETH_USDT',
      candles1h,
      ltp: { price: 107.8, basis: 0.0015, openInterest: 1200, syntheticFundingRate: 0.0002 },
      historyByPair,
      nowMs: now,
    });

    expect(['uptrend', 'downtrend', 'range']).toContain(out.marketStructureShift.trend);
    expect(['bullish', 'bearish', 'none']).toContain(out.marketStructureShift.mss);
    expect(out.dailyWeeklyPivots.daily).not.toBeNull();
    expect(out.dailyWeeklyPivots.weekly).not.toBeNull();
    expect(['bullish', 'bearish', 'neutral']).toContain(out.emaBiasFilter.bias);
  });

  it('classifies OI/price truth table and basis/funding extremes', () => {
    const now = 20_000_000;
    const candles1h = Array.from({ length: 20 }, (_unused, index) =>
      candle(
        now - ((20 - index) * 3_600_000),
        100 + (index * 0.2),
        101 + (index * 0.2),
        99 + (index * 0.2),
        100.5 + (index * 0.2),
      ));

    const pairHistory: SwingHistoryPoint[] = [
      { ts: now - 180_000, price: 100, openInterest: 1000, basis: 0.001, syntheticFundingRate: 0.0002 },
      { ts: now - 120_000, price: 101, openInterest: 1050, basis: 0.002, syntheticFundingRate: 0.0003 },
      { ts: now - 60_000, price: 102, openInterest: 1100, basis: 0.003, syntheticFundingRate: 0.0004 },
      { ts: now, price: 103, openInterest: 1200, basis: 0.006, syntheticFundingRate: 0.0012 },
    ];
    const btcHistory: SwingHistoryPoint[] = [
      { ts: now - 180_000, price: 60000 },
      { ts: now - 120_000, price: 60600 },
      { ts: now - 60_000, price: 61200 },
      { ts: now, price: 62000 },
    ];

    const historyByPair = new Map<string, SwingHistoryPoint[]>([
      ['B-ETH_USDT', pairHistory],
      ['B-BTC_USDT', btcHistory],
      ['B-SOL_USDT', [
        { ts: now - 180_000, price: 200 },
        { ts: now - 120_000, price: 201 },
        { ts: now - 60_000, price: 202 },
        { ts: now, price: 202.2 },
      ]],
    ]);

    const out = computeSwingIndicators({
      pair: 'B-ETH_USDT',
      candles1h,
      ltp: { price: 103, basis: 0.006, openInterest: 1200, syntheticFundingRate: 0.0012 },
      historyByPair,
      nowMs: now,
    });

    expect(out.oiPriceTruthTable.classification).toBe('long-buildup');
    expect(out.fundingRateExtremes.extreme).toBe('positive');
    expect(out.spotFuturesBasis.state).toBe('contango');
    expect(['allow', 'caution']).toContain(out.btcDominanceCorrelationFilter.filter);
  });
});
