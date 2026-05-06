/**
 * SCAFFOLD — slice #8 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Add Kelly-fraction and volatility-target sizing modes alongside the
 * existing fixed-fractional risk used in
 * `src/runtime/trade-plan.ts:115-117`. The TradePlanEngine selects a
 * `sizingMode` per signal and the resulting risk capital flows through
 * the existing leverage / liquidation buffer guards unchanged.
 *
 * IMPORTANT — read-only constraint
 * ---------------------------------
 * This module computes a number that lands in the signal payload only.
 * No code path here may directly or indirectly call an exchange. The
 * `ReadOnlyGuard` (`src/safety/read-only-guard.ts`) remains the final
 * line of defence; nothing in this module should ever attempt to bypass
 * it, even speculatively.
 *
 * Sizing modes
 * ------------
 *   FIXED_FRACTIONAL — current behaviour: riskCapital = equity × fraction
 *   KELLY            — riskCapital = equity × KellyFraction × kellyScale,
 *                      where KellyFraction = winRate − (1 − winRate)/avgRR.
 *                      Always clamp to [0, fixedFractionalCap] so a Kelly
 *                      blow-up cannot exceed the conservative baseline.
 *   VOL_TARGET       — riskCapital = equity × (targetDailyVol / atrPercent)
 *                      capped to fixedFractionalCap.
 *
 * The Kelly fraction must be derived from a *recent rolling* backtest /
 * paper-trade window, not lifetime stats — strategy decay is real.
 *
 * Iteration checklist
 * -------------------
 *  [ ] `KellyEstimator` consumes `BacktestMetrics` from a rolling window
 *      and returns `{ fraction, sampleSize, confidence }`
 *  [ ] `VolTargetSizer` consumes ATR-percent + target daily vol
 *  [ ] `pickSizing(input)` chooses mode based on regime + confluence:
 *        - high confluence + trending regime → KELLY (capped)
 *        - low confluence + range regime     → FIXED_FRACTIONAL
 *        - high vol regime                   → VOL_TARGET
 *  [ ] Add config keys to `src/config/schema.ts`:
 *        TRADEPLAN_SIZING_MODE                ('fixed' | 'kelly' | 'vol_target' | 'auto')
 *        TRADEPLAN_KELLY_SCALE                (0.25 default — quarter-Kelly)
 *        TRADEPLAN_KELLY_MIN_SAMPLE           (50 default)
 *        TRADEPLAN_VOL_TARGET_DAILY           (0.01 default — 1%/day)
 *  [ ] Wire into `TradePlanEngine.compute` so existing 10× hard cap and
 *      liquidation-buffer rule still gate the result
 *  [ ] Tests:
 *        - Kelly degenerates to FIXED below MIN_SAMPLE
 *        - vol-target inversely scales with ATR
 *        - all modes respect the hard leverage cap
 *  [ ] Update tracking doc when wired
 *
 * Non-goals (deferred)
 * --------------------
 * - Portfolio-level sizing across correlated pairs (would need a full
 *   covariance matrix; out of scope until multi-pair sizing is on the
 *   roadmap)
 * - Optimal-f (Vince) — Kelly is the conservative default
 */

export type SizingMode = 'fixed_fractional' | 'kelly' | 'vol_target';

export interface SizingInput {
  /** Account equity in INR (or quote ccy). */
  equity: number;
  /** The conservative baseline (currently 0.01). All modes are capped at this. */
  fixedFractionalCap: number;
  /** Optional rolling backtest stats — required for Kelly mode. */
  rollingStats?: {
    winRate: number;
    avgWin: number;
    avgLoss: number;
    sampleSize: number;
  };
  /** Optional ATR percent — required for vol-target mode. */
  atrPercent?: number;
  /** Target daily volatility (e.g. 0.01 for 1%) — vol-target mode. */
  targetDailyVol?: number;
  /** Kelly scale factor (typically 0.25 for quarter-Kelly). */
  kellyScale?: number;
  /** Minimum sample size before Kelly mode is allowed. */
  kellyMinSample?: number;
  /** Requested mode; if 'auto', pickSizing(input) decides. */
  mode: SizingMode | 'auto';
}

export interface SizingResult {
  mode: SizingMode;
  /** Final risk capital in INR. */
  riskCapital: number;
  /** Fraction of equity actually risked. */
  fraction: number;
  /** Reason / fallback notes for downstream observability. */
  reason: string;
}

/**
 * SCAFFOLD — returns the conservative baseline until slice #8 is implemented.
 */
export function computeSizing(input: SizingInput): SizingResult {
  // TODO(slice #8): implement KELLY / VOL_TARGET branches.
  //   const mode = input.mode === 'auto' ? pickSizing(input) : input.mode;
  //   switch (mode) { ... }
  //   apply fixedFractionalCap as final clamp.
  const fraction = input.fixedFractionalCap;
  return {
    mode: 'fixed_fractional',
    riskCapital: Math.max(0, input.equity * fraction),
    fraction,
    reason: 'scaffold: fixed_fractional fallback',
  };
}

/**
 * Kelly fraction f* = p − q/b   where b = avgWin / avgLoss, q = 1 − p.
 *
 * Returns 0 when sample is too small or RR is non-positive — we never want
 * Kelly to *increase* size below the baseline; the baseline already covers
 * that case via the cap.
 */
export function kellyFraction(_winRate: number, _avgWin: number, _avgLoss: number): number {
  // TODO(slice #8): implement and unit-test edge cases (p≤0, p≥1, b≤0).
  return 0;
}

/**
 * Heuristic auto-mode selector. Pure function of inputs.
 */
export function pickSizing(_input: SizingInput): SizingMode {
  // TODO(slice #8):
  //   - sampleSize < kellyMinSample          → fixed_fractional
  //   - atrPercent missing                   → fixed_fractional
  //   - regime/confluence inputs (extend signature) decide between
  //     kelly and vol_target
  return 'fixed_fractional';
}
