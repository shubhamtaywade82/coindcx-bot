import type { EntryType, TradeIntent } from '../execution/trade-intent';
import type {
  IntentMarketContext,
  IntentValidationDecision,
  IntentValidatorOptions,
} from '../execution/intent-validator';
import type { Signal } from '../signals/types';
import { ConfluenceScorer, type ConfluenceScore } from './confluence-scorer';
import { OrderRouter, type RoutedOrder } from './order-router';
import {
  PositionStateMachine,
  type PositionStateSnapshot,
} from './position-state-machine';
import {
  RegimeClassifier,
  type RegimeFeatures,
  type RegimeSnapshot,
} from './regime-classifier';
import { RiskManager, type RiskEvaluation } from './risk-manager';
import { SignalEngine } from './signal-engine';

export interface RuntimeSignalContext {
  market?: IntentMarketContext;
  regimeFeatures?: RegimeFeatures;
  riskOptions?: IntentValidatorOptions;
  defaultEntryType?: EntryType;
}

export interface RoutedRuntimeDecision {
  status: 'routed';
  pair: string;
  intent: TradeIntent;
  riskDecision: IntentValidationDecision;
  riskEvaluation: RiskEvaluation;
  regime: RegimeSnapshot;
  confluence: ConfluenceScore;
  routedOrder: RoutedOrder;
  positionState: PositionStateSnapshot;
}

export interface BlockedRuntimeDecision {
  status: 'blocked';
  pair: string;
  intent: TradeIntent;
  riskDecision: IntentValidationDecision;
  riskEvaluation: RiskEvaluation;
  regime: RegimeSnapshot;
  confluence: ConfluenceScore;
}

export type RuntimeDecision = RoutedRuntimeDecision | BlockedRuntimeDecision;

export class CoreRuntimePipeline {
  readonly signalEngine: SignalEngine;
  readonly regimeClassifier: RegimeClassifier;
  readonly confluenceScorer: ConfluenceScorer;
  readonly riskManager: RiskManager;
  readonly orderRouter: OrderRouter;
  readonly positionStateMachine: PositionStateMachine;

  constructor(
    modules: Partial<{
      signalEngine: SignalEngine;
      regimeClassifier: RegimeClassifier;
      confluenceScorer: ConfluenceScorer;
      riskManager: RiskManager;
      orderRouter: OrderRouter;
      positionStateMachine: PositionStateMachine;
    }> = {},
  ) {
    this.signalEngine = modules.signalEngine ?? new SignalEngine();
    this.regimeClassifier = modules.regimeClassifier ?? new RegimeClassifier();
    this.confluenceScorer = modules.confluenceScorer ?? new ConfluenceScorer();
    this.riskManager = modules.riskManager ?? new RiskManager();
    this.orderRouter = modules.orderRouter ?? new OrderRouter();
    this.positionStateMachine = modules.positionStateMachine ?? new PositionStateMachine();
  }

  process(signal: Signal, context: RuntimeSignalContext = {}): RuntimeDecision | null {
    const intent = this.signalEngine.buildTradeIntent({
      signal,
      defaultEntryType: context.defaultEntryType,
    });
    if (!intent) return null;

    const regime = this.regimeClassifier.classify(intent.pair, context.regimeFeatures ?? {});
    const confluence = this.confluenceScorer.score({
      pair: intent.pair,
      side: intent.side,
      confidence: intent.confidence,
      regime: regime.regime,
    });
    const riskEvaluation = this.riskManager.evaluate({
      intent,
      market: context.market,
      options: context.riskOptions,
    });

    if (!riskEvaluation.decision.approved) {
      return {
        status: 'blocked',
        pair: intent.pair,
        intent,
        riskDecision: riskEvaluation.decision,
        riskEvaluation,
        regime,
        confluence,
      };
    }

    const routedOrder = this.orderRouter.route(riskEvaluation.decision.intent);
    const positionState = this.positionStateMachine.transition(intent.pair, {
      type: 'intent_routed',
      reason: routedOrder.reason,
    });
    return {
      status: 'routed',
      pair: intent.pair,
      intent,
      riskDecision: riskEvaluation.decision,
      riskEvaluation,
      regime,
      confluence,
      routedOrder,
      positionState,
    };
  }
}
