import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

export class PerPairCooldownRule implements RiskRule {
  readonly id = 'per_pair_cooldown';
  private lastEmit = new Map<string, number>();

  constructor(private cooldownMs: number) {}

  apply(ctx: RiskRuleContext): RuleDecision {
    if (ctx.signal.side === 'WAIT') return { pass: true, ruleId: this.id };
    const key = `${ctx.manifest.id}|${ctx.signal.side}|${ctx.pair}`;
    const last = this.lastEmit.get(key) ?? 0;
    if (ctx.now - last < this.cooldownMs) {
      return { pass: false, ruleId: this.id,
        reason: `cooldown ${this.cooldownMs}ms not elapsed (last ${ctx.now - last}ms ago)` };
    }
    return { pass: true, ruleId: this.id };
  }

  recordEmit(strategyId: string, pair: string, side: 'LONG' | 'SHORT', ts: number): void {
    this.lastEmit.set(`${strategyId}|${side}|${pair}`, ts);
  }
}

