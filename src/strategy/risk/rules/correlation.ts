import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

export class OpposingPairCorrelationRule implements RiskRule {
  readonly id = 'opposing_pair_correlation';

  constructor(private windowMs: number) {}

  apply(ctx: RiskRuleContext): RuleDecision {
    if (ctx.signal.side === 'WAIT') return { pass: true, ruleId: this.id };
    const cutoff = ctx.now - this.windowMs;
    const opposing = ctx.signal.side === 'LONG' ? 'SHORT' : 'LONG';
    const conflict = ctx.liveSignals.find(
      s => s.pair === ctx.pair && s.side === opposing && s.ts >= cutoff,
    );
    if (conflict) {
      return { pass: false, ruleId: this.id,
        reason: `opposing live ${opposing} on ${ctx.pair} from ${conflict.strategyId}` };
    }
    return { pass: true, ruleId: this.id };
  }
}
