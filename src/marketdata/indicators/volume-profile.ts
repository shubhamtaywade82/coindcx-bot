import type { Candle } from '../../ai/state-builder';

/**
 * SCAFFOLD — slice #2 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Compute Volume Profile / Market Profile statistics over a candle window:
 *   - Point of Control (POC): price bin with the highest traded volume
 *   - Value Area High / Low (VAH / VAL): the contiguous bin band that
 *     contains `valueAreaPct` (typically 0.7) of total volume around POC
 *   - Naked POCs: prior POCs that have not yet been retested
 *
 * Combined with anchored VWAP bands (already computed in
 * `intraday-indicators.ts`), this gives the SMC strategies a volume context
 * they currently lack — POC acts like a magnet, VAH/VAL define the
 * "fair-value" envelope, and a sweep of the value area into a return
 * inside is a textbook reversion trigger.
 *
 * Why this matters
 * ----------------
 * SMC structure breaks that occur *outside* the value area have a much
 * higher follow-through rate than ones inside it. Surfacing this lets the
 * confluence scorer down-weight signals fired in chop.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Bin candles by price (configurable tick size or auto-derived from ATR)
 *  [ ] Distribute candle volume across price range linearly (proxy until we
 *      have tick data) or use TradeFlow ticks if available for the window
 *  [ ] Compute POC = argmax bin
 *  [ ] Walk outward from POC accumulating volume until valueAreaPct reached;
 *      VAH/VAL are the outermost bins included
 *  [ ] Track naked POCs across rolling N sessions
 *  [ ] Surface as a new field on `IntradayIndicators` (extend type in
 *      `src/marketdata/intraday-indicators.ts`)
 *  [ ] Confluence consumer in `src/runtime/confluence-scorer.ts`:
 *        - inside-VA when SMC fires LONG → -confluence
 *        - sweep of VAL with reclaim → +confluence to LONG
 *  [ ] Unit tests with deterministic candle fixtures
 *  [ ] Update tracking doc row to `wired` then `validated`
 *
 * Non-goals (deferred)
 * --------------------
 * - True TPO (Time-Price Opportunity) letters — volume-only profile is
 *   strictly more useful for crypto perps.
 * - Composite multi-day profiles — start with single-day, iterate later.
 */

export interface VolumeProfileBin {
  /** Lower bound of the price bin (inclusive). */
  priceLow: number;
  /** Upper bound of the price bin (exclusive). */
  priceHigh: number;
  /** Volume traded inside this bin in the window. */
  volume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  /** Price at the centre of the highest-volume bin. */
  poc: number;
  /** Upper bound of the value area band. */
  vah: number;
  /** Lower bound of the value area band. */
  val: number;
  /** Fraction of total volume contained inside [val, vah]. */
  valueAreaPct: number;
  /** Total volume traded across the window. */
  totalVolume: number;
}

export interface ComputeVolumeProfileInput {
  candles: Candle[];
  /** Number of price bins. Defaults to 50 if undefined. */
  binCount?: number;
  /** Target value-area fraction. Defaults to 0.7. */
  valueAreaPct?: number;
}

/**
 * Compute a single-window volume profile.
 *
 * SCAFFOLD — returns an empty profile until slice #2 is implemented.
 */
export function computeVolumeProfile(_input: ComputeVolumeProfileInput): VolumeProfile {
  // TODO(slice #2):
  //   1. Determine [priceMin, priceMax] over candles.
  //   2. Build bins of equal width.
  //   3. For each candle, distribute volume across the bins it spans
  //      (linear approximation until tick data is available).
  //   4. Locate POC bin.
  //   5. Expand outward summing volume until valueAreaPct hit.
  return {
    bins: [],
    poc: NaN,
    vah: NaN,
    val: NaN,
    valueAreaPct: 0,
    totalVolume: 0,
  };
}

export interface NakedPoc {
  /** Session start ts (ms). */
  sessionTs: number;
  /** POC price level that has not yet been retested. */
  price: number;
  /** Distance, in current ATR units, from the most recent close. */
  distanceAtr: number;
}

/**
 * Track naked POCs across recent sessions.
 *
 * SCAFFOLD — stub implementation; will become stateful once #2 lands.
 */
export class NakedPocTracker {
  // TODO(slice #2): rolling window of completed sessions, retest detection.
  list(): NakedPoc[] {
    return [];
  }
}
