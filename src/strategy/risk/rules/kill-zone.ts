import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

/**
 * SCAFFOLD — slice #1 of the prerequisite implementation plan.
 * See `docs/prerequisites-implementation-plan.md` for the full checklist.
 *
 * Purpose
 * -------
 * Gate signal emission to high-probability "kill zone" sessions used in
 * SMC/ICT methodology — typically London open (06:00–10:00 UTC), New York
 * open (12:00–16:00 UTC), and an optional Asia killzone (00:00–04:00 UTC).
 * Outside those windows we suppress LONG/SHORT signals (WAIT passes through
 * unchanged so account-state and integrity events still flow).
 *
 * Why this matters
 * ----------------
 * Empirically, SMC structure breaks during low-liquidity hours have a higher
 * false-positive rate. Kill-zone gating filters by *time* before any
 * structural rule fires, which composes cheaply with the existing risk chain.
 *
 * Iteration checklist
 * -------------------
 *  [ ] Implement window evaluation (UTC mod-of-day, weekend flag)
 *  [ ] Add config keys to `src/config/schema.ts`:
 *        RISK_KILLZONE_ENABLED            (default false — opt-in)
 *        RISK_KILLZONE_WINDOWS_UTC        ("06:00-10:00,12:00-16:00")
 *        RISK_KILLZONE_BLOCK_WEEKENDS     (default true)
 *  [ ] Wire into `CompositeRiskFilter` build site in `src/index.ts`,
 *      placed after `MinConfidence` and before `PerPairCooldown` so the
 *      cooldown stamp only records signals that actually emit.
 *  [ ] Tests under `tests/strategy/risk/rules/kill-zone.test.ts`:
 *       - boundary minutes (start inclusive, end exclusive)
 *       - multi-window union
 *       - weekend block
 *       - DST insensitivity (we operate in UTC; DST should not shift windows)
 *  [ ] Update `docs/prerequisites-implementation-plan.md` row to `wired`
 *      then `validated` after a 30-day backtest comparison.
 *
 * Non-goals
 * ---------
 * - Per-pair window overrides (deferred until needed)
 * - Holiday calendars (deferred — crypto runs 24/7)
 */

export interface KillZoneWindow {
  /** Inclusive start minute of day in UTC, 0..1439. */
  startMinuteUtc: number;
  /** Exclusive end minute of day in UTC, 1..1440. */
  endMinuteUtc: number;
  /** Human-readable label (e.g. "london", "ny"). */
  label: string;
}

export interface KillZoneRuleOptions {
  windows: KillZoneWindow[];
  blockWeekends: boolean;
  /** Optional clock injection for tests. */
  now?: () => number;
}

export class KillZoneRule implements RiskRule {
  readonly id = 'kill_zone';

  constructor(private readonly opts: KillZoneRuleOptions) {
    // TODO(slice #1): validate window ranges (start < end, within 0..1440).
  }

  apply(_ctx: RiskRuleContext): RuleDecision {
    // TODO(slice #1): real implementation
    //   1. If signal.side === 'WAIT' → pass.
    //   2. Compute UTC minute-of-day from ctx.now (or this.opts.now).
    //   3. If blockWeekends && weekend → block with reason "weekend".
    //   4. If any window covers the minute → pass.
    //   5. Otherwise block with reason "outside_kill_zone:<label-list>".
    //
    // For now the scaffold passes everything through so it can be safely
    // imported but not registered. Registration is intentionally a separate
    // step in `src/index.ts` once the logic is filled in.
    return { pass: true, ruleId: this.id };
  }
}

/**
 * Parse a comma-separated env value like "06:00-10:00,12:00-16:00" into
 * KillZoneWindow[]. Exported for use by the config layer once wired.
 */
export function parseKillZoneWindows(_spec: string): KillZoneWindow[] {
  // TODO(slice #1): regex split, HH:MM → minute count, label inference.
  return [];
}
