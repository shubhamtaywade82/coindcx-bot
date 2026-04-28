import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

export class MaxConcurrentSignalsRule implements RiskRule {
  readonly id = 'max_concurrent_signals';

  constructor(private cap: number, private windowMs: number) {}

  apply(ctx: RiskRuleContext): RuleDecision {
    if (ctx.signal.side === 'WAIT') return { pass: true, ruleId: this.id };
    const cutoff = ctx.now - this.windowMs;
    const live = ctx.liveSignals.filter(s => s.ts >= cutoff);
    if (live.length >= this.cap) {
      return { pass: false, ruleId: this.id,
        reason: `concurrent live signals ${live.length} >= cap ${this.cap}` };
    }
    return { pass: true, ruleId: this.id };
  }
}
