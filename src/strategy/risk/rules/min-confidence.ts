import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

export class MinConfidenceRule implements RiskRule {
  readonly id = 'min_confidence';

  constructor(private threshold: number) {}

  apply(ctx: RiskRuleContext): RuleDecision {
    if (ctx.signal.side === 'WAIT') return { pass: true, ruleId: this.id };
    if (ctx.signal.confidence < this.threshold) {
      return { pass: false, ruleId: this.id, reason: `confidence ${ctx.signal.confidence} < ${this.threshold}` };
    }
    return { pass: true, ruleId: this.id };
  }
}
