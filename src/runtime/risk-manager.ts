import {
  validateTradeIntent,
  type IntentMarketContext,
  type IntentValidationDecision,
  type IntentValidatorOptions,
} from '../execution/intent-validator';
import type { TradeIntent } from '../execution/trade-intent';

export interface RiskManagerInput {
  intent: TradeIntent;
  market?: IntentMarketContext;
  options?: IntentValidatorOptions;
}

export interface RiskEvaluation {
  pair: string;
  evaluatedAt: string;
  decision: IntentValidationDecision;
}

export class RiskManager {
  private readonly byPair = new Map<string, RiskEvaluation>();

  constructor(private readonly clock: () => number = Date.now) {}

  evaluate(input: RiskManagerInput): RiskEvaluation {
    const decision = validateTradeIntent({
      intent: input.intent,
      market: input.market,
      options: input.options,
    });
    const evaluation: RiskEvaluation = {
      pair: input.intent.pair,
      evaluatedAt: new Date(this.clock()).toISOString(),
      decision,
    };
    this.byPair.set(input.intent.pair, evaluation);
    return evaluation;
  }

  current(pair: string): RiskEvaluation | undefined {
    return this.byPair.get(pair);
  }
}
