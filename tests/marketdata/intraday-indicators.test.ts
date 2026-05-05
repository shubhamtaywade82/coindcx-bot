import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/ai/state-builder';
import { computeIntradayIndicators } from '../../src/marketdata/intraday-indicators';
import { TradeFlow } from '../../src/marketdata/trade-flow';

function makeCandle(timestamp: number, open: number, close: number, volume = 10): Candle {
  const high = Math.max(open, close) + 1;
  const low = Math.min(open, close) - 1;
  return { timestamp, open, high, low, close, volume };
}

function buildCandles(
  startTs: number,
  count: number,
  stepMs: number,
  basePrice = 100,
  slope = 0.1,
): Candle[] {
  const candles: Candle[] = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = startTs + (index * stepMs);
    const open = basePrice + (index * slope);
    const close = open + (index % 2 === 0 ? slope : -slope / 2);
    candles.push(makeCandle(timestamp, open, close, 10 + (index % 5)));
  }
  return candles;
}

describe('computeIntradayIndicators', () => {
  it('computes anchored VWAP contexts and EMA stack', () => {
    const now = Date.UTC(2026, 4, 3, 13, 0, 0, 0);
    const candles1m = buildCandles(now - (120 * 60_000), 120, 60_000, 100, 0.2);
    const candles15m = buildCandles(now - (60 * 15 * 60_000), 60, 15 * 60_000, 98, 0.4);

    const out = computeIntradayIndicators({
      pair: 'B-X_USDT',
      candles1m,
      candles15m,
      nowMs: now,
    });

    expect(out.anchoredVwap.session).toBeGreaterThan(0);
    expect(out.anchoredVwap.daily).toBeGreaterThan(0);
    expect(out.anchoredVwap.swing).toBeGreaterThan(0);
    expect(out.emaStack.ema9).toBeGreaterThan(0);
    expect(out.emaStack.ema21).toBeGreaterThan(0);
    expect(out.emaStack.ema50).toBeGreaterThan(0);
  });

  it('derives rolling order-flow imbalance from trade flow when available', () => {
    const now = 2_000_000;
    const candles1m = buildCandles(now - (30 * 60_000), 30, 60_000, 100, 0.05);
    const candles15m = buildCandles(now - (40 * 15 * 60_000), 40, 15 * 60_000, 100, 0.2);
    const flow = new TradeFlow();
    flow.ingestRaw({ T: now - 30_000, p: '100', q: '2', m: false, s: 'B-X_USDT' }); // buy-aggressive
    flow.ingestRaw({ T: now - 20_000, p: '100.1', q: '1', m: true, s: 'B-X_USDT' }); // sell-aggressive
    flow.ingestRaw({ T: now - 10_000, p: '100.2', q: '3', m: false, s: 'B-X_USDT' }); // buy-aggressive

    const out = computeIntradayIndicators({
      pair: 'B-X_USDT',
      candles1m,
      candles15m,
      tradeFlow: flow,
      nowMs: now,
    });

    expect(out.rollingOrderFlowImbalance.source).toBe('trade-flow');
    expect(out.rollingOrderFlowImbalance.buyVolume).toBe(5);
    expect(out.rollingOrderFlowImbalance.sellVolume).toBe(1);
    expect(out.rollingOrderFlowImbalance.value).toBeCloseTo((5 - 1) / 6);
  });

  it('falls back to candle-derived imbalance when trade flow is absent', () => {
    const now = 3_000_000;
    const candles1m = [
      ...buildCandles(now - (10 * 60_000), 10, 60_000, 100, 0.05),
      makeCandle(now - 2 * 60_000, 101, 100, 20),
      makeCandle(now - 60_000, 100, 99, 22),
      makeCandle(now, 99, 98, 25),
    ];
    const candles15m = buildCandles(now - (30 * 15 * 60_000), 30, 15 * 60_000, 100, 0.2);

    const out = computeIntradayIndicators({
      pair: 'B-X_USDT',
      candles1m,
      candles15m,
      nowMs: now,
    });

    expect(out.rollingOrderFlowImbalance.source).toBe('candle-fallback');
    expect(out.rollingOrderFlowImbalance.value).toBeLessThan(0);
  });

  it('returns bounded ATR percentile and valid RSI divergence classification', () => {
    const now = 4_000_000;
    const candles1m = buildCandles(now - (250 * 60_000), 250, 60_000, 100, 0.02);
    const candles15m = buildCandles(now - (240 * 15 * 60_000), 240, 15 * 60_000, 95, 0.15);

    const out = computeIntradayIndicators({
      pair: 'B-X_USDT',
      candles1m,
      candles15m,
      nowMs: now,
    });

    expect(out.atrPercentileRank.percentile).toBeGreaterThanOrEqual(0);
    expect(out.atrPercentileRank.percentile).toBeLessThanOrEqual(1);
    expect(['bullish', 'bearish', 'none']).toContain(out.rsiDivergence.divergence);
  });
});
