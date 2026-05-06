/**
 * SCAFFOLD — slice #10b of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Approximate queue-position dynamics for *limit* orders in the backtester.
 * When the simulator places a passive limit at a price level, it joins the
 * back of the queue at that level. The order only fills when:
 *   - the level is touched (price = limit), AND
 *   - enough opposing-side volume has traded through to consume the
 *     existing queue ahead of us.
 *
 * Model
 * -----
 *   queueAhead := book.size at price when our order is placed
 *   on each subsequent trade at price p:
 *       if our side is LONG and p == limit:
 *           queueAhead -= tradedQty
 *       if queueAhead <= 0:
 *           order fills at limit
 *
 * Cancel/replace and adverse-price (level vacated by trades through us)
 * scenarios are deferred — start with a "stand and wait" approximation.
 *
 * Why this matters
 * ----------------
 * Without a queue model, every limit price the simulator picks fills
 * instantly when touched, which radically over-states passive-fill
 * profitability. Even a crude queue-ahead counter rebalances the metrics
 * toward something realistic.
 *
 * Iteration checklist
 * -------------------
 *  [ ] `LimitOrderState` with priceLevel, queueAhead, ourQty, side
 *  [ ] `applyTradeAtLevel(state, tradedQty)` decrements queueAhead, then
 *      fills our qty up to remaining trade flow
 *  [ ] Wire into the backtester as an opt-in mode (off by default)
 *  [ ] Tests for: zero queue (immediate fill), partial queue consumption,
 *      cancel-without-fill (deferred behaviour stub)
 *  [ ] Update tracking doc when wired
 */

export interface LimitOrderState {
  side: 'LONG' | 'SHORT';
  priceLevel: number;
  /** Volume ahead of our order in the queue. */
  queueAhead: number;
  /** Our remaining quantity. */
  remainingQty: number;
  filledQty: number;
}

/**
 * Apply a trade that prints at our price level.
 *
 * SCAFFOLD — no-op until slice #10b is implemented.
 */
export function applyTradeAtLevel(state: LimitOrderState, _tradedQty: number): LimitOrderState {
  // TODO(slice #10b):
  //   1. consumed = min(queueAhead, tradedQty)
  //   2. queueAhead -= consumed; tradedQty -= consumed
  //   3. fillNow = min(tradedQty, remainingQty)
  //   4. filledQty += fillNow; remainingQty -= fillNow
  return state;
}
