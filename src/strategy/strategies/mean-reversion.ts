import type { Candle } from '../../ai/state-builder';
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

/**
 * SCAFFOLD — slice #5 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * A mean-reversion strategy that fires *only* in low-volatility,
 * range-bound regimes — the regime classifier (`runtime/regime-classifier.ts`)
 * already labels these as `range`. Outside those regimes, momentum
 * dominates and mean-reversion bleeds; the regime gate is what keeps this
 * strategy from cancelling out the trend-following ones.
 *
 * Entry logic (long side; short side is symmetric)
 * ------------------------------------------------
 *   - Compute Bollinger %B on closes (default 20, 2σ)
 *   - Compute Z-score of close vs rolling mean
 *   - Require ATR-percentile rank ≤ 30 (low-vol gate)
 *   - Require regime label === 'range'
 *   - Trigger LONG when %B ≤ 0.0 and prior bar was outside the band
 *   - Stop-loss: 2 × ATR below entry (volatility-adjusted)
 *   - Take-profit: midband (typical mean target)
 *
 * Why this matters
 * ----------------
 * Adds regime coverage. Today the bot is overweight breakout / structure
 * strategies. In range regimes those produce frequent low-quality signals;
 * a true mean-reversion strategy harvests that exact regime instead.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Implement Bollinger Band + Z-score helpers (or pull canonical
 *      versions once slice #7 lands)
 *  [ ] Wire regime + ATR-percentile gates to MarketState
 *  [ ] Long-side then short-side entries
 *  [ ] Strategy manifest gated by `STRATEGY_ENABLED_IDS` in `src/index.ts`
 *  [ ] Tests with synthetic range fixtures + a trending fixture asserting
 *      no signals fire
 *  [ ] Update tracking doc when wired
 *
 * Non-goals (deferred)
 * --------------------
 * - Pairs trading / co-integration variant — needs cross-pair plumbing
 * - Adaptive band widths via Donchian / Keltner — keep scope small
 */

const MANIFEST: StrategyManifest = {
  id: 'mean.reversion.v1',
  version: '0.0.0-scaffold',
  mode: 'bar_close',
  barTimeframes: ['15m'],
  pairs: ['*'],
  warmupCandles: 60,
  description: 'SCAFFOLD: Bollinger %B mean reversion gated by range regime — not implemented',
};

export class MeanReversionStrategy implements Strategy {
  manifest = MANIFEST;
  private closes: number[] = [];

  clone(): Strategy {
    return new MeanReversionStrategy();
  }

  warmup(ctx: { pair: string; candles: Candle[] }): void {
    this.closes = ctx.candles.map((c) => c.close);
  }

  evaluate(_ctx: StrategyContext): StrategySignal | null {
    // TODO(slice #5):
    //   1. Append latest close from marketState; trim to lookback (200).
    //   2. If marketState.regime !== 'range' → return null.
    //   3. If atrPercentileRank > 30 → return null.
    //   4. Compute Bollinger %B and Z-score.
    //   5. Long entry: %B ≤ 0 and prev close > prev lower-band; SL = entry - 2*ATR; TP = mid.
    //   6. Short entry: symmetric.
    //   7. Otherwise return WAIT.
    return null;
  }
}

/**
 * Pure helpers — exported for unit testing.
 *
 * TODO(slice #5): implement using shared canonical primitives once slice #7
 * provides reference EMA / stdev. For now they return NaN.
 */
export function bollingerPercentB(_closes: number[], _length: number, _stddev: number): number {
  return NaN;
}

export function zScore(_value: number, _series: number[]): number {
  return NaN;
}
