import type { AccountSnapshot } from '../../../account/types';
import type { StrategyManifest, StrategySignal } from '../../types';

export interface RuleDecision {
  pass: boolean;
  reason?: string;
  ruleId: string;
}

export interface RiskRuleContext {
  signal: StrategySignal;
  manifest: StrategyManifest;
  pair: string;
  account: AccountSnapshot;
  liveSignals: ReadonlyArray<{ strategyId: string; pair: string; ts: number; side: 'LONG' | 'SHORT' }>;
  now: number;
}

export interface RiskRule {
  readonly id: string;
  apply(ctx: RiskRuleContext): RuleDecision;
}
