/**
 * SCAFFOLD — slice #10a of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Replace the binary fill model in `Simulator.markToMarket*` (a position
 * either fills at the printed price or doesn't at all) with a partial-fill
 * model parameterised by orderbook depth at each price level.
 *
 * Model (deliberately simple)
 * ---------------------------
 *   At signal time the orderbook snapshot is captured. The intended
 *   quantity is walked across price levels:
 *       remaining = qty
 *       avgPrice  = 0
 *       for each level in the resting book up to a price-impact cap:
 *           taken = min(remaining, level.size)
 *           avgPrice += level.price * taken
 *           remaining -= taken
 *           if remaining == 0: break
 *       if remaining > 0: position only partially opens; flag in the
 *       resulting trade as `partialFillRatio < 1`.
 *
 * Why this matters
 * ----------------
 * The current `pessimistic` flag picks SL when both SL and TP could trigger
 * in the same bar but says nothing about *getting in*. In thin pairs, a
 * 1R move during entry can be the difference between a winning and losing
 * trade. Partial-fill simulation surfaces that risk in backtest metrics.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Define `OrderBookLevel[]` snapshot input
 *  [ ] Implement walkBook(side, qty, levels, maxImpactBps)
 *  [ ] Extend `OpenPosition` with avgEntryPrice + partialFillRatio
 *  [ ] Wire as an opt-in option on `Simulator` so existing tests keep
 *      passing under the legacy binary-fill mode
 *  [ ] Tests with deterministic book fixtures
 *  [ ] Update tracking doc when wired
 */

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface PartialFillResult {
  filledQty: number;
  remainingQty: number;
  /** Volume-weighted average fill price; NaN if no fill. */
  avgPrice: number;
  /** Price impact in basis points vs the best price on the relevant side. */
  priceImpactBps: number;
}

export interface WalkBookArgs {
  side: 'LONG' | 'SHORT';
  qty: number;
  /** Pre-sorted: asks ascending for LONG, bids descending for SHORT. */
  levels: OrderBookLevel[];
  /** Walk stops before exceeding this impact (default 50 bps). */
  maxImpactBps?: number;
}

/**
 * SCAFFOLD — returns no-fill until slice #10a is implemented.
 */
export function walkBook(_args: WalkBookArgs): PartialFillResult {
  // TODO(slice #10a): implement walkBook per the docstring above.
  return { filledQty: 0, remainingQty: _args.qty, avgPrice: NaN, priceImpactBps: 0 };
}
