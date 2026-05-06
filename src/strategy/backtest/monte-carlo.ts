import type { ClosedTrade } from './simulator';
import type { BacktestMetrics } from './metrics';

/**
 * SCAFFOLD — slice #9a of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Walk-forward validation already lives in `walk-forward.ts`. This module
 * adds a Monte Carlo permutation layer on top of an existing trade ledger:
 * shuffle the closed trades thousands of times and recompute the metrics
 * distribution. The point is to ask "was the equity curve we observed
 * unusually good, or is it indistinguishable from a random ordering of the
 * same trades?".
 *
 * Two complementary tests
 * -----------------------
 *  1. Trade-sequence permutation — randomise trade order, recompute Sharpe
 *     / max drawdown / Calmar. The *observed* Sharpe should sit comfortably
 *     above the median of the permutation distribution.
 *  2. Bootstrap resampling — sample N trades with replacement, recompute
 *     metrics. Yields confidence intervals on Sharpe / win-rate / avgR.
 *
 * Why this matters
 * ----------------
 * Walk-forward checks robustness across time. Monte Carlo checks robustness
 * to ordering and sampling — a strategy with a great Sharpe whose drawdown
 * is purely a function of the lucky early sequence will fail this test.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Implement `permuteLedger` (Fisher–Yates) and `bootstrapLedger`
 *  [ ] Reuse `computeMetrics` from `metrics.ts` per replication
 *  [ ] Aggregate distributions: percentiles 5/25/50/75/95 for each metric
 *  [ ] Surface p-value: P(metric_perm ≥ metric_observed) under permutation
 *  [ ] CLI flag `--monte-carlo N` on `npm run backtest`
 *  [ ] JSON + markdown report under `docs/backtest-reports/`
 *  [ ] Tests with deterministic seeded RNG
 *  [ ] Update tracking doc when validated
 *
 * Non-goals (deferred)
 * --------------------
 * - Block bootstrap (preserves time-correlation) — start with iid bootstrap
 * - Synthetic-data Monte Carlo (resampling returns from a fitted model) —
 *   that lives one step beyond and depends on slice #7
 */

export interface MonteCarloConfig {
  iterations: number;
  /** Deterministic seed for reproducibility; defaults to Date.now(). */
  seed?: number;
  /** Bootstrap with replacement when true; permute when false. */
  withReplacement?: boolean;
}

export interface MetricDistribution {
  observed: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  /** P(metric_replicated >= metric_observed). */
  pValue: number;
}

export interface MonteCarloReport {
  iterations: number;
  withReplacement: boolean;
  observed: BacktestMetrics;
  distributions: {
    sharpe: MetricDistribution;
    profitFactor: MetricDistribution;
    maxDrawdownPct: MetricDistribution;
    calmar: MetricDistribution;
    avgR: MetricDistribution;
  };
}

/**
 * SCAFFOLD — returns a stub report until slice #9a is implemented.
 */
export function runMonteCarlo(
  _trades: ClosedTrade[],
  _config: MonteCarloConfig,
): MonteCarloReport {
  // TODO(slice #9a):
  //   1. Compute observed metrics once.
  //   2. Loop `iterations` times:
  //        a. permuted = withReplacement ? bootstrap(trades) : permute(trades);
  //        b. metrics = computeMetrics(permuted);
  //        c. push each tracked metric into a distribution array.
  //   3. Sort each distribution; pick percentiles; compute p-values.
  //   4. Return MonteCarloReport.
  return _emptyReport();
}

export function permuteLedger(_trades: ClosedTrade[], _seed: number): ClosedTrade[] {
  // TODO(slice #9a): Fisher–Yates with seeded PRNG (mulberry32 is fine).
  return [];
}

export function bootstrapLedger(_trades: ClosedTrade[], _seed: number): ClosedTrade[] {
  // TODO(slice #9a): sample-with-replacement of trades.length items.
  return [];
}

function _emptyReport(): MonteCarloReport {
  const empty: MetricDistribution = {
    observed: NaN, p05: NaN, p25: NaN, p50: NaN, p75: NaN, p95: NaN, pValue: NaN,
  };
  return {
    iterations: 0,
    withReplacement: false,
    observed: {
      totalPnl: 0, tradeCount: 0, winRate: 0, avgR: 0, profitFactor: 0,
      sharpe: 0, calmar: 0, maxDrawdown: 0, maxDrawdownPct: 0,
      annualizedReturn: 0, medianTimeToOneRMs: 0,
      breakevenLockBeforeNegativeCloseRate: 0, avgWin: 0, avgLoss: 0,
    },
    distributions: {
      sharpe: empty, profitFactor: empty, maxDrawdownPct: empty,
      calmar: empty, avgR: empty,
    },
  };
}
