/**
 * SCAFFOLD — slice #7 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Provide *textbook* reference implementations of the technical indicators
 * the bot already uses inline (EMA, RSI, ATR, MACD, Bollinger, stdev) and
 * a property-based validation harness that asserts the bespoke versions
 * scattered through `src/marketdata/intraday-indicators.ts`,
 * `src/marketdata/swing-indicators.ts`, etc. agree to within a small
 * tolerance.
 *
 * Why this matters
 * ----------------
 * We have no external dependency such as `talib`/`technicalindicators`. The
 * inline indicators are easy to drift from canonical formulas during
 * refactors, and a single off-by-one in EMA seeding will shift every
 * downstream signal. A test-only harness pins these definitions without
 * adding a runtime dep or refactoring callers.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Implement `referenceEma`, `referenceRsi`, `referenceAtr`,
 *      `referenceMacd`, `referenceBollinger`, `referenceStdev`
 *      using textbook formulas (Wilder for RSI/ATR, EMA seeded with SMA)
 *  [ ] Add fixtures under `tests/fixtures/canonical/` (csv: ohlcv + expected)
 *  [ ] Property tests under `tests/indicators/canonical/`:
 *        - shape + monotonicity invariants
 *        - cross-check each bespoke implementation vs the reference
 *          using `fast-check` (already in devDependencies)
 *  [ ] Document tolerance (default: 1e-9 abs / 1e-6 relative)
 *  [ ] Update tracking doc when validated
 *
 * NOTE
 * ----
 * This module is consumed only by tests today. If a future iteration finds
 * a bespoke implementation drifting from canonical, replace the bespoke
 * call site with this reference rather than hand-editing the bespoke code.
 */

export interface ToleranceSpec {
  /** Absolute tolerance applied first; defaults to 1e-9. */
  abs?: number;
  /** Relative tolerance applied after abs; defaults to 1e-6. */
  rel?: number;
}

export const DEFAULT_TOLERANCE: Required<ToleranceSpec> = { abs: 1e-9, rel: 1e-6 };

export function withinTolerance(a: number, b: number, tol: ToleranceSpec = DEFAULT_TOLERANCE): boolean {
  const abs = tol.abs ?? DEFAULT_TOLERANCE.abs;
  const rel = tol.rel ?? DEFAULT_TOLERANCE.rel;
  const diff = Math.abs(a - b);
  if (diff <= abs) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return diff <= rel * scale;
}

/**
 * Canonical SMA (simple moving average).
 *
 * Returns NaN until `length` samples are available, then the rolling mean.
 * Output array has the same length as `closes`.
 */
export function referenceSma(_closes: number[], _length: number): number[] {
  // TODO(slice #7): implement
  return [];
}

/**
 * Canonical EMA. Seeds with the SMA of the first `length` samples (the
 * convention used by TradingView, ta-lib, and most charting platforms).
 */
export function referenceEma(_closes: number[], _length: number): number[] {
  // TODO(slice #7): implement
  return [];
}

/**
 * Canonical RSI per Wilder.
 *
 *   gain[i] = max(close[i] - close[i-1], 0)
 *   loss[i] = max(close[i-1] - close[i], 0)
 *   avgGain = SMMA(gain, length); avgLoss = SMMA(loss, length)
 *   RS  = avgGain / avgLoss
 *   RSI = 100 - 100 / (1 + RS)
 */
export function referenceRsi(_closes: number[], _length: number): number[] {
  // TODO(slice #7): implement
  return [];
}

/**
 * Canonical ATR per Wilder. TR = max(high-low, |high-prevClose|, |low-prevClose|).
 */
export function referenceAtr(
  _high: number[],
  _low: number[],
  _close: number[],
  _length: number,
): number[] {
  // TODO(slice #7): implement
  return [];
}

export interface MacdSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function referenceMacd(
  _closes: number[],
  _fast: number,
  _slow: number,
  _signal: number,
): MacdSeries {
  // TODO(slice #7): EMA(fast) - EMA(slow), signal = EMA(macd, signal)
  return { macd: [], signal: [], histogram: [] };
}

export interface BollingerBands {
  middle: number[];
  upper: number[];
  lower: number[];
}

export function referenceBollinger(_closes: number[], _length: number, _stddev: number): BollingerBands {
  // TODO(slice #7): SMA + ±k*stdev with same window length
  return { middle: [], upper: [], lower: [] };
}

/**
 * Sample standard deviation over the last `length` samples.
 */
export function referenceStdev(_values: number[], _length: number): number[] {
  // TODO(slice #7): implement (n-1 denominator for sample stdev)
  return [];
}

/**
 * Generic comparator used by the property tests.
 * Returns the index of the first element that violates tolerance, or -1.
 */
export function firstDeviation(
  a: number[],
  b: number[],
  tol: ToleranceSpec = DEFAULT_TOLERANCE,
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? NaN;
    const bv = b[i] ?? NaN;
    if (Number.isNaN(av) && Number.isNaN(bv)) continue;
    if (!withinTolerance(av, bv, tol)) return i;
  }
  return -1;
}
