import type { BacktestSummary } from './runner';

/**
 * SCAFFOLD — slice #9b of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Sweep strategy parameters over a user-supplied grid and report the
 * stability surface. A parameter that produces a sharp local maximum on
 * Sharpe is almost certainly overfit; one that produces a broad plateau
 * is more trustworthy.
 *
 * Why this matters
 * ----------------
 * A backtest with a single hand-picked set of parameters tells you nothing
 * about whether *neighbouring* parameter values would have collapsed. A
 * grid sweep is the cheapest, most-informative robustness check we can
 * add on top of walk-forward + Monte Carlo (slice #9a).
 *
 * Iteration checklist
 * -------------------
 *  [ ] Define `ParameterAxis` and `ParameterGrid` types (numeric for now)
 *  [ ] Implement Cartesian-product expansion
 *  [ ] Run backtest per combination via the existing runner
 *  [ ] Stability score per axis: stdev(Sharpe) across the axis / mean(Sharpe)
 *  [ ] Report cluster around best: how many neighbouring combos sit
 *      within X% of the best Sharpe?
 *  [ ] CLI flag `--sensitivity grid.json` on `npm run backtest`
 *  [ ] JSON + markdown report alongside the Monte Carlo report
 *  [ ] Tests with a tiny grid + deterministic stub backtest function
 *  [ ] Update tracking doc when validated
 *
 * Non-goals (deferred)
 * --------------------
 * - Bayesian optimisation / TPE — heavy and risks re-overfitting
 * - Multi-objective fronts (Sharpe vs DD) — start with Sharpe only
 */

export interface ParameterAxis {
  /** Strategy parameter name (e.g. "fastEmaLength"). */
  name: string;
  /** Discrete values to sweep — keep the grid small (≤ 10 per axis). */
  values: Array<number | string>;
}

export interface ParameterGrid {
  /** Strategy id this grid is for (sanity check). */
  strategyId: string;
  axes: ParameterAxis[];
}

export type ParameterCombination = Record<string, number | string>;

export interface SensitivityCell {
  combination: ParameterCombination;
  summary: BacktestSummary;
}

export interface AxisStability {
  axis: string;
  meanSharpe: number;
  stdevSharpe: number;
  /** Lower = more stable plateau. */
  coefficientOfVariation: number;
}

export interface SensitivityReport {
  cells: SensitivityCell[];
  bestCombination: ParameterCombination;
  bestSharpe: number;
  /** Number of cells within 10% of the best Sharpe. Higher = more robust. */
  cellsWithin10pct: number;
  axes: AxisStability[];
}

export interface SensitivitySweepArgs {
  grid: ParameterGrid;
  runOne: (combo: ParameterCombination) => Promise<BacktestSummary>;
}

/**
 * SCAFFOLD — returns an empty report until slice #9b is implemented.
 */
export async function runSensitivitySweep(_args: SensitivitySweepArgs): Promise<SensitivityReport> {
  // TODO(slice #9b):
  //   1. Expand grid via cartesianProduct(axes).
  //   2. For each combo: cells.push({ combination, summary: await runOne(combo) }).
  //   3. Find bestCombination (max Sharpe).
  //   4. Compute cellsWithin10pct = #{ |sharpe - best| / best <= 0.10 }.
  //   5. Per axis: collect Sharpe per value, compute mean/stdev/CV.
  return {
    cells: [],
    bestCombination: {},
    bestSharpe: 0,
    cellsWithin10pct: 0,
    axes: [],
  };
}

export function cartesianProduct(_axes: ParameterAxis[]): ParameterCombination[] {
  // TODO(slice #9b): iterative Cartesian expansion preserving axis order.
  return [];
}
