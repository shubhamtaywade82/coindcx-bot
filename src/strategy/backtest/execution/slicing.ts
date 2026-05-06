/**
 * SCAFFOLD — slice #10c of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Simulate parent-order slicing strategies (TWAP / VWAP) inside the
 * backtester. The bot is read-only and never sends orders, but if it
 * eventually feeds *paper* trade plans into a downstream router, those
 * plans should already account for execution costs introduced by slicing.
 *
 * IMPORTANT — read-only constraint
 * ---------------------------------
 * Nothing in this file may construct, schedule, or hand off a real
 * exchange order. This is offline simulation only. The `ReadOnlyGuard`
 * (`src/safety/read-only-guard.ts`) is the canonical kill-switch and must
 * remain in force.
 *
 * Slicing modes
 * -------------
 *   TWAP — break parent qty into N equal child slices, evenly spaced over
 *          a configurable duration. Each child is a market or marketable
 *          limit (modelled via `partial-fills.ts` walkBook).
 *   VWAP — break parent qty into child slices proportional to a target
 *          volume curve (default: typical intraday curve). Allocate slice
 *          qty for the i-th time bucket as parentQty * curve[i].
 *
 * Why this matters
 * ----------------
 * Backtests that assume a 100% fill at a single price systematically
 * under-state slippage on size. TWAP/VWAP slicing reveals how much edge
 * survives after realistic execution. It's also the only honest way to
 * compare strategies that demand different position sizes.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Implement `buildTwapSchedule(parent, childCount, durationMs, startMs)`
 *  [ ] Implement `buildVwapSchedule(parent, curve, startMs, endMs)`
 *  [ ] Default volume curve fixture under `tests/fixtures/vwap-curve.csv`
 *  [ ] Integrate with `partial-fills.ts` walkBook so each child consumes
 *      depth realistically
 *  [ ] Output `effectiveAvgPrice` aggregated across children
 *  [ ] Tests for: even TWAP, U-shaped VWAP curve, zero-duration edge case
 *  [ ] Update tracking doc when wired
 *
 * Non-goals (deferred)
 * --------------------
 * - Adaptive slicing (Almgren–Chriss) — needs cost model + market impact
 *   parameters fitted to live data
 * - Iceberg / passive-aggressive hybrids — depends on slice #10b queue
 *   model maturing first
 */

export interface ChildOrder {
  /** Scheduled emission time (ms). */
  ts: number;
  /** Quantity for this child. */
  qty: number;
  /** Identifier index within the parent (0..N-1). */
  index: number;
}

export interface ParentOrder {
  side: 'LONG' | 'SHORT';
  totalQty: number;
}

export interface TwapArgs {
  parent: ParentOrder;
  childCount: number;
  durationMs: number;
  startMs: number;
}

export interface VwapArgs {
  parent: ParentOrder;
  /** Normalised volume curve summing to 1.0; one entry per bucket. */
  volumeCurve: number[];
  startMs: number;
  endMs: number;
}

/**
 * SCAFFOLD — empty schedule until slice #10c is implemented.
 */
export function buildTwapSchedule(_args: TwapArgs): ChildOrder[] {
  // TODO(slice #10c):
  //   step = durationMs / childCount
  //   childQty = totalQty / childCount  (rounded; carry remainder to last child)
  //   for i in 0..childCount-1: schedule[i] = { ts: startMs + i*step, qty, index: i }
  return [];
}

/**
 * SCAFFOLD — empty schedule until slice #10c is implemented.
 */
export function buildVwapSchedule(_args: VwapArgs): ChildOrder[] {
  // TODO(slice #10c):
  //   buckets = volumeCurve.length
  //   bucketMs = (endMs - startMs) / buckets
  //   for i in 0..buckets-1:
  //     schedule[i] = { ts: startMs + i*bucketMs, qty: totalQty * volumeCurve[i], index: i }
  //   verify sum(volumeCurve) ≈ 1; reject otherwise.
  return [];
}
