import type { Candle } from '../../ai/state-builder';
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

/**
 * SCAFFOLD — slice #6 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Detect classical RSI / MACD divergences against price pivots and emit
 * reversal signals when both indicators agree.
 *
 * Divergence taxonomy
 * -------------------
 *   regular bullish — price makes lower-low, RSI makes higher-low      → LONG bias
 *   regular bearish — price makes higher-high, RSI makes lower-high    → SHORT bias
 *   hidden bullish  — price higher-low, RSI lower-low (continuation)   → LONG add
 *   hidden bearish  — price lower-high, RSI higher-high (continuation) → SHORT add
 *
 * Why this matters
 * ----------------
 * The existing `RsiDivergenceSignal` in `intraday-indicators.ts` reports a
 * single boolean per pair. A dedicated strategy that *acts* on confirmed
 * divergences (with MACD cross-check) makes that latent feature investable
 * and orthogonal to structure-break logic.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Pivot detector with configurable left/right strength (default 3/3)
 *  [ ] RSI divergence detector across last K pivots
 *  [ ] MACD histogram divergence cross-check (require same direction)
 *  [ ] Hidden vs regular classifier
 *  [ ] Entry on divergence confirmation candle close; SL = pivot extreme;
 *      TP1 = previous swing, TP2 = 2R
 *  [ ] Strategy manifest gated by `STRATEGY_ENABLED_IDS`
 *  [ ] Tests with synthetic fixtures for each of the four divergence kinds
 *  [ ] Update tracking doc when wired
 *
 * Non-goals (deferred)
 * --------------------
 * - Multi-timeframe divergences (HTF RSI vs LTF price) — once core is solid
 * - Divergences on volume or OBV — requires reliable volume data
 */

const MANIFEST: StrategyManifest = {
  id: 'divergence.rsi-macd.v1',
  version: '0.0.0-scaffold',
  mode: 'bar_close',
  barTimeframes: ['15m'],
  pairs: ['*'],
  warmupCandles: 80,
  description: 'SCAFFOLD: RSI + MACD divergence reversal — not implemented',
};

export type DivergenceKind = 'regular_bull' | 'regular_bear' | 'hidden_bull' | 'hidden_bear' | 'none';

export interface PricePivot {
  index: number;
  ts: number;
  price: number;
  kind: 'high' | 'low';
}

export class DivergenceStrategy implements Strategy {
  manifest = MANIFEST;
  private bars: Candle[] = [];

  clone(): Strategy {
    return new DivergenceStrategy();
  }

  warmup(ctx: { pair: string; candles: Candle[] }): void {
    this.bars = ctx.candles.slice(-200);
  }

  evaluate(_ctx: StrategyContext): StrategySignal | null {
    // TODO(slice #6):
    //   1. Append latest closed bar to `this.bars`.
    //   2. pivots = detectPivots(this.bars, leftStrength, rightStrength).
    //   3. rsi[] from canonical RSI helper (slice #7).
    //   4. macd-hist[] from canonical MACD helper (slice #7).
    //   5. classifyDivergence(pivots, rsi, macd) → DivergenceKind.
    //   6. If regular_bull → LONG; regular_bear → SHORT;
    //      hidden_*: only emit if existing trend-following strategies are
    //      already long/short for the same pair (avoid contradictory).
    //   7. Otherwise return null.
    return null;
  }
}

/**
 * Pure helpers — exported for unit testing.
 *
 * TODO(slice #6): implement using slice #7 canonical primitives.
 */
export function detectPivots(
  _bars: Candle[],
  _leftStrength: number,
  _rightStrength: number,
): PricePivot[] {
  return [];
}

export function classifyDivergence(
  _pivots: PricePivot[],
  _rsi: number[],
  _macdHist: number[],
): DivergenceKind {
  return 'none';
}
