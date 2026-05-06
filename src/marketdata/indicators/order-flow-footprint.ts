import type { TradeFlow, TradeTick } from '../trade-flow';

/**
 * SCAFFOLD — slice #4 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Extend the existing `rollingOrderFlowImbalance` (a single rolling number
 * per window) into a full footprint-style aggressor profile per price bin
 * inside a candle. From the per-bin profile we can compute:
 *   - Stacked imbalances: 3+ consecutive bins where buy or sell aggression
 *     dominates above a ratio threshold (typically 2.0)
 *   - Absorption: large aggressive volume hitting a level with no price
 *     follow-through (signals a hidden limit-order wall)
 *   - Delta divergence: candle closes up but cumulative delta is negative
 *     (or vice versa) — a leading reversal hint
 *
 * Why this matters
 * ----------------
 * SMC infers institutional intent from price structure alone. Footprint /
 * aggressor analysis confirms (or contradicts) that inference using actual
 * trade-flow. Used as a confluence input it both raises confidence on
 * agreeing signals and cuts the false-positive rate on disagreeing ones.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Bin `TradeTick`s by price within a candle's [open, close] window
 *  [ ] Per bin: track buyVolume, sellVolume, aggressorRatio
 *  [ ] Stacked-imbalance detector with configurable ratio + min run length
 *  [ ] Absorption detector: max(aggressorVol) at level / range expansion
 *      below a threshold ⇒ absorption
 *  [ ] Delta divergence detector across N candles
 *  [ ] Extend `IntradayIndicators` (in `src/marketdata/intraday-indicators.ts`)
 *      with a new `orderFlowFootprint` field
 *  [ ] Confluence consumer in `src/runtime/confluence-scorer.ts`:
 *        agreeing footprint → +confluence; absorption against signal direction → block
 *  [ ] Tests with synthetic `TradeTick[]` fixtures
 *  [ ] Update tracking doc when wired
 *
 * Non-goals (deferred)
 * --------------------
 * - Per-tick reconstruction of the order book (would require L3 data
 *   CoinDCX does not expose)
 * - Volume-weighted footprint with limit-order persistence ("DOM ladder")
 */

export interface FootprintBin {
  priceLow: number;
  priceHigh: number;
  buyVolume: number;
  sellVolume: number;
  /** buyVolume / sellVolume; Infinity if sellVolume === 0. */
  aggressorRatio: number;
}

export interface StackedImbalance {
  side: 'buy' | 'sell';
  /** First bin index in the run. */
  fromBinIndex: number;
  /** Last bin index in the run (inclusive). */
  toBinIndex: number;
  /** Geometric mean of aggressor ratios across the run. */
  meanRatio: number;
}

export interface AbsorptionEvent {
  priceLevel: number;
  side: 'buy' | 'sell';
  aggressorVolume: number;
  /** ATR-normalised price travel away from the level after the print. */
  travelAtr: number;
}

export interface OrderFlowFootprint {
  bins: FootprintBin[];
  cumulativeDelta: number;
  stackedImbalances: StackedImbalance[];
  absorption: AbsorptionEvent[];
  deltaDivergence: 'bullish' | 'bearish' | 'none';
}

export interface ComputeFootprintInput {
  pair: string;
  /** Candle window [openMs, closeMs]. */
  fromMs: number;
  toMs: number;
  /** Recent trade ticks; the function will filter by ts. */
  ticks: TradeTick[];
  /** Bin width in price units; if undefined, derive from ATR / 5. */
  binSize?: number;
  /** Stacked-imbalance ratio threshold; default 2.0. */
  stackedRatio?: number;
  /** Minimum consecutive bins to qualify as stacked; default 3. */
  stackedMinRun?: number;
}

/**
 * SCAFFOLD — returns an empty footprint until slice #4 is implemented.
 */
export function computeOrderFlowFootprint(_input: ComputeFootprintInput): OrderFlowFootprint {
  // TODO(slice #4):
  //   1. Filter ticks to [fromMs, toMs].
  //   2. Determine binSize (param or ATR-derived).
  //   3. Allocate bins from min..max price.
  //   4. Walk ticks: increment buy/sell volume per bin from `buyAggressive`.
  //   5. detectStackedImbalances(bins, stackedRatio, stackedMinRun).
  //   6. detectAbsorption(bins, candleRange, atr).
  //   7. detectDeltaDivergence(currentCumDelta vs prior N candles' close).
  return {
    bins: [],
    cumulativeDelta: 0,
    stackedImbalances: [],
    absorption: [],
    deltaDivergence: 'none',
  };
}

/**
 * Convenience adapter — pull the most recent ticks for a pair from the
 * existing `TradeFlow` aggregator.
 *
 * TODO(slice #4): TradeFlow currently exposes window metrics only. Extend
 * it (or add a buffered tap) to surface raw ticks for footprint binning.
 */
export function ticksFromTradeFlow(_flow: TradeFlow, _pair: string, _windowMs: number): TradeTick[] {
  // TODO(slice #4): hook into TradeFlow's internal buffer; consider
  // exposing a read-only iterator on the aggregator instead of mirroring
  // the data here.
  return [];
}
