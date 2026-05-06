import type { Candle } from '../../ai/state-builder';
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

/**
 * SCAFFOLD — slice #3 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Detect Wyckoff accumulation / distribution phases A→E and emit signals on
 * Phase-C events (spring / upthrust) and Phase-D markup / markdown
 * confirmations. Wyckoff is the historical foundation SMC was repackaged
 * from — adding it gives us a second, semantically-orthogonal structural
 * lens on the same price data.
 *
 * Phases (reference, accumulation case)
 * -------------------------------------
 *  A — Stopping action: PSY (preliminary support), SC (selling climax), AR
 *      (automatic rally), ST (secondary test).
 *  B — Building cause: range trading, declining volume.
 *  C — Test: Spring — false break of range low, immediate reclaim,
 *      typically with declining volume on the break, expanding on reclaim.
 *  D — Markup: SOS (sign of strength) bars, LPS (last point of support).
 *  E — Out of range: trend established.
 *
 * Distribution mirrors with BC / UT / UTAD / SOW / LPSY.
 *
 * Why this matters
 * ----------------
 * Wyckoff supplies high-conviction reversal points (springs) that SMC's
 * BOS-based logic does not directly capture. Combining the two reduces
 * false positives in choppy ranges.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Range detection over rolling N bars (default 60 on 15m) — needs ATR
 *      contraction + flat structure
 *  [ ] Volume-profile dependency (slice #2): require POC inside the range
 *      and price testing VAL/VAH
 *  [ ] Spring detection: low pierces range low by ≥ K * ATR but close
 *      reclaims; volume on the pierce ≤ rolling avg
 *  [ ] Upthrust detection: symmetric short-side
 *  [ ] Phase classifier emits a richer enum on `meta.phase`
 *  [ ] Signal construction: entry = reclaim close, SL = spring extreme +
 *      buffer, TP1 = opposite end of range, TP2 = range projection
 *  [ ] Strategy manifest with `STRATEGY_ENABLED_IDS` gating in `src/index.ts`
 *  [ ] Tests under `tests/strategy/strategies/wyckoff-phase.test.ts` using
 *      synthetic accumulation→markup fixtures
 *  [ ] Update tracking doc row when wired
 */

const MANIFEST: StrategyManifest = {
  id: 'wyckoff.phase.v1',
  version: '0.0.0-scaffold',
  mode: 'bar_close',
  barTimeframes: ['15m'],
  pairs: ['*'],
  warmupCandles: 120,
  description: 'SCAFFOLD: Wyckoff phase detector (springs / upthrusts) — not implemented',
};

export type WyckoffPhase = 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown';

export interface WyckoffMeta {
  phase: WyckoffPhase;
  rangeHigh: number;
  rangeLow: number;
  springDetected: boolean;
  upthrustDetected: boolean;
}

export class WyckoffPhaseStrategy implements Strategy {
  manifest = MANIFEST;
  // TODO(slice #3): persist rolling candle window per pair for range tracking.
  private bars: Candle[] = [];

  clone(): Strategy {
    return new WyckoffPhaseStrategy();
  }

  warmup(ctx: { pair: string; candles: Candle[] }): void {
    // TODO(slice #3): seed `this.bars` and pre-compute initial range.
    this.bars = ctx.candles.slice(-200);
  }

  evaluate(_ctx: StrategyContext): StrategySignal | null {
    // TODO(slice #3): full implementation. The skeleton always returns
    // null so registering the strategy is safe-but-silent until done.
    //
    // Pseudocode:
    //   1. Update rolling bars buffer with marketState close.
    //   2. classifyRange(bars) → { rangeHigh, rangeLow, atrContraction }.
    //   3. detectSpring(bars, range) / detectUpthrust(bars, range).
    //   4. Update phase classification (A..E).
    //   5. If spring + reclaim → LONG signal with SL = spring low.
    //      If upthrust + rejection → SHORT signal with SL = upthrust high.
    //   6. Otherwise return WAIT or null.
    return null;
  }
}

/**
 * Pure helpers exported for unit testing — kept side-effect free.
 *
 * TODO(slice #3): implement these and add property tests.
 */
export function detectSpring(_bars: Candle[]): boolean {
  return false;
}

export function detectUpthrust(_bars: Candle[]): boolean {
  return false;
}

export function classifyPhase(_bars: Candle[]): WyckoffPhase {
  return 'unknown';
}
