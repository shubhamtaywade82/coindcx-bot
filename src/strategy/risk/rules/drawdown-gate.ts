import type { RiskRule, RiskRuleContext, RuleDecision } from './types';

export class DrawdownGateRule implements RiskRule {
  readonly id = 'drawdown_gate';
  private peak = 0;

  constructor(private maxDrawdownPct: number) {}

  apply(ctx: RiskRuleContext): RuleDecision {
    if (ctx.signal.side === 'WAIT') return { pass: true, ruleId: this.id };
    const equity = Number(ctx.account.totals.equityInr);
    if (!Number.isFinite(equity) || equity <= 0) return { pass: true, ruleId: this.id };
    if (equity > this.peak) this.peak = equity;
    if (this.peak <= 0) return { pass: true, ruleId: this.id };
    const dd = (this.peak - equity) / this.peak;
    if (dd >= this.maxDrawdownPct) {
      return { pass: false, ruleId: this.id,
        reason: `drawdown ${(dd * 100).toFixed(2)}% >= ${(this.maxDrawdownPct * 100).toFixed(2)}%` };
    }
    return { pass: true, ruleId: this.id };
  }

  resetPeak(): void { this.peak = 0; }
  currentPeak(): number { return this.peak; }
}
