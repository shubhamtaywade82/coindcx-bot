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
import { TradePlanEngine, type TradePlan } from './trade-plan';
import { RiskManager, type RiskEvaluation } from './risk-manager';
import { SignalEngine } from './signal-engine';

export interface RuntimeSignalContext {
  market?: IntentMarketContext;
  regimeFeatures?: RegimeFeatures;
  riskOptions?: IntentValidatorOptions;
  defaultEntryType?: EntryType;
  confluenceComponents?: Record<string, number>;
  microstructureContribution?: number;
  tradePlanOverrides?: Partial<{
    accountEquity: number;
    riskCapitalFraction: number;
    atrPercent: number;
    feeRate: number;
    fundingRate: number;
    maxVenueLeverage: number;
    liquidationBufferMultiplier: number;
  }>;
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
  pendingEntriesCancelled: boolean;
  tradePlan: TradePlan;
}

export interface BlockedRuntimeDecision {
  status: 'blocked';
  pair: string;
  intent: TradeIntent;
  riskDecision: IntentValidationDecision;
  riskEvaluation: RiskEvaluation;
  regime: RegimeSnapshot;
  confluence: ConfluenceScore;
  reason:
    | 'confluence_gate'
    | 'risk_gate';
  pendingEntriesCancelled: boolean;
  tradePlan?: TradePlan;
}

export type RuntimeDecision = RoutedRuntimeDecision | BlockedRuntimeDecision;

function confluenceBlockedDecision(message: string): IntentValidationDecision {
  return {
    approved: false,
    rejections: [{
      code: 'reward_risk_too_low',
      message,
    }],
  };
}

function confluenceBlockedEvaluation(pair: string, evaluatedAt: string, decision: IntentValidationDecision): RiskEvaluation {
  return {
    pair,
    evaluatedAt,
    decision,
  };
}

export class CoreRuntimePipeline {
  readonly signalEngine: SignalEngine;
  readonly regimeClassifier: RegimeClassifier;
  readonly confluenceScorer: ConfluenceScorer;
  readonly tradePlanEngine: TradePlanEngine;
  readonly riskManager: RiskManager;
  readonly orderRouter: OrderRouter;
  readonly positionStateMachine: PositionStateMachine;
  private readonly pendingIntentByPair = new Map<string, TradeIntent>();

  constructor(
    modules: Partial<{
      signalEngine: SignalEngine;
      regimeClassifier: RegimeClassifier;
      confluenceScorer: ConfluenceScorer;
      tradePlanEngine: TradePlanEngine;
      riskManager: RiskManager;
      orderRouter: OrderRouter;
      positionStateMachine: PositionStateMachine;
    }> = {},
  ) {
    this.signalEngine = modules.signalEngine ?? new SignalEngine();
    this.regimeClassifier = modules.regimeClassifier ?? new RegimeClassifier();
    this.confluenceScorer = modules.confluenceScorer ?? new ConfluenceScorer();
    this.tradePlanEngine = modules.tradePlanEngine ?? new TradePlanEngine();
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
    const pendingEntriesCancelled = this.cancelPendingEntriesOnRegimeChange(intent.pair, regime);
    const confluence = this.confluenceScorer.score({
      pair: intent.pair,
      side: intent.side,
      confidence: intent.confidence,
      regime: regime.regime,
      ...(context.confluenceComponents ? { components: context.confluenceComponents } : {}),
      ...(context.microstructureContribution !== undefined
        ? { microstructureContribution: context.microstructureContribution }
        : {}),
    });
    const confluenceDecision = this.confluenceScorer.decision(intent.pair);
    const tradePlan = this.tradePlanEngine.compute({
      intent,
      confluence,
      market: context.market,
      regime: regime.regime,
      atrPercent: context.tradePlanOverrides?.atrPercent,
      accountEquity: context.tradePlanOverrides?.accountEquity,
      riskCapitalFraction: context.tradePlanOverrides?.riskCapitalFraction,
      feeRate: context.tradePlanOverrides?.feeRate,
      fundingRate: context.tradePlanOverrides?.fundingRate,
      maxVenueLeverage: context.tradePlanOverrides?.maxVenueLeverage,
    });
    if (!confluenceDecision?.shouldFire || confluenceDecision.dominantSide === 'NONE') {
      this.pendingIntentByPair.set(intent.pair, intent);
      const riskDecision = confluenceBlockedDecision('blocked by confluence gate');
      return {
        status: 'blocked',
        pair: intent.pair,
        intent,
        riskDecision,
        riskEvaluation: confluenceBlockedEvaluation(intent.pair, confluence.scoredAt, riskDecision),
        regime,
        confluence,
        reason: 'confluence_gate',
        pendingEntriesCancelled,
        tradePlan,
      };
    }
    if (intent.side !== confluenceDecision.dominantSide) {
      this.pendingIntentByPair.set(intent.pair, intent);
      const riskDecision = confluenceBlockedDecision('blocked by dominant-side confluence mismatch');
      return {
        status: 'blocked',
        pair: intent.pair,
        intent,
        riskDecision,
        riskEvaluation: confluenceBlockedEvaluation(intent.pair, confluence.scoredAt, riskDecision),
        regime,
        confluence,
        reason: 'confluence_gate',
        pendingEntriesCancelled,
        tradePlan,
      };
    }
    const riskEvaluation = this.riskManager.evaluate({
      intent,
      market: context.market,
      options: context.riskOptions,
    });

    if (!riskEvaluation.decision.approved) {
      this.pendingIntentByPair.set(intent.pair, intent);
      return {
        status: 'blocked',
        pair: intent.pair,
        intent,
        riskDecision: riskEvaluation.decision,
        riskEvaluation,
        regime,
        confluence,
        reason: 'risk_gate',
        pendingEntriesCancelled,
        tradePlan,
      };
    }

    const routedOrder = this.orderRouter.route(riskEvaluation.decision.intent);
    this.pendingIntentByPair.delete(intent.pair);
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
      pendingEntriesCancelled,
      tradePlan,
    };
  }

  pendingIntent(pair: string): TradeIntent | undefined {
    return this.pendingIntentByPair.get(pair);
  }

  private cancelPendingEntriesOnRegimeChange(pair: string, regime: RegimeSnapshot): boolean {
    if (!regime.changed) return false;
    return this.pendingIntentByPair.delete(pair);
  }
}
