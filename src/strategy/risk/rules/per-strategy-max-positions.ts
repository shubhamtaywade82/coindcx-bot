import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

export class PerStrategyMaxPositionsRule implements RiskRule {
  readonly id = 'per_strategy_max_positions';

  constructor(private cap: number, private windowMs: number) {}

  apply(ctx: RiskRuleContext): RuleDecision {
    if (ctx.signal.side === 'WAIT') return { pass: true, ruleId: this.id };
    const cutoff = ctx.now - this.windowMs;
    const live = ctx.liveSignals.filter(s => s.ts >= cutoff && s.strategyId === ctx.manifest.id);
    if (live.length >= this.cap) {
      return { pass: false, ruleId: this.id,
        reason: `strategy ${ctx.manifest.id} live signals ${live.length} >= cap ${this.cap}` };
    }
    return { pass: true, ruleId: this.id };
  }
}
