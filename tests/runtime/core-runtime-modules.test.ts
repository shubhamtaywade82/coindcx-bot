import { describe, expect, it } from 'vitest';
import type { Signal } from '../../src/signals/types';
import { ConfluenceScorer } from '../../src/runtime/confluence-scorer';
import { OrderRouter } from '../../src/runtime/order-router';
import { PositionStateMachine } from '../../src/runtime/position-state-machine';
import { RegimeClassifier, classifyRegime } from '../../src/runtime/regime-classifier';
import { RiskManager } from '../../src/runtime/risk-manager';
import { SignalEngine } from '../../src/runtime/signal-engine';
import { CoreRuntimePipeline } from '../../src/runtime/runtime-pipeline';

function baseSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-1',
    ts: '2026-05-03T12:00:00.000Z',
    strategy: 'llm.pulse.v1',
    type: 'strategy.long',
    pair: 'B-BTC_USDT',
    severity: 'warn',
    payload: {
      confidence: 0.9,
      reason: 'test setup',
      entry: '100',
      stopLoss: '95',
      takeProfit: '112',
      ttlMs: 60_000,
    },
    ...overrides,
  };
}

describe('runtime module skeletons', () => {
  it('classifies regime with explicit precedence', () => {
    expect(classifyRegime({ adx4h: 28, bbWidthPercentile: 0.1 })).toBe('trending');
    expect(classifyRegime({
      adx4h: 10,
      atrPercentile: 0.4,
      bbWidthPercentile: 0.1,
    })).toBe('compressed');
    expect(classifyRegime({ adx4h: 10, atrPercentile: 0.4, bbWidthPercentile: 0.7 })).toBe('ranging');
    expect(classifyRegime({ adx4h: 22, atrPercentile: 0.9, bbWidthPercentile: 0.8 })).toBe('volatile');
    expect(classifyRegime({ adx4h: 19, atrPercentile: 40, bbWidthPercentile: 15 })).toBe('compressed');
  });

  it('stores classifier snapshots by pair on 5 minute cadence', () => {
    let nowMs = Date.parse('2026-05-03T12:00:00.000Z');
    const classifier = new RegimeClassifier(() => nowMs);

    const first = classifier.classify('B-BTC_USDT', {
      adx4h: 30,
      atrPercentile: 0.2,
      bbWidthPercentile: 0.2,
    });
    expect(first.regime).toBe('trending');
    expect(first.changed).toBe(false);
    expect(classifier.current('B-BTC_USDT')?.classifiedAt).toBe('2026-05-03T12:00:00.000Z');

    nowMs = Date.parse('2026-05-03T12:01:00.000Z');
    const sameBucket = classifier.classify('B-BTC_USDT', {
      adx4h: 10,
      atrPercentile: 0.4,
      bbWidthPercentile: 0.7,
    });
    expect(sameBucket).toBe(first);

    nowMs = Date.parse('2026-05-03T12:06:00.000Z');
    const nextBucket = classifier.classify('B-BTC_USDT', {
      adx4h: 10,
      atrPercentile: 0.4,
      bbWidthPercentile: 0.7,
    });
    expect(nextBucket.regime).toBe('ranging');
    expect(nextBucket.changed).toBe(true);
    expect(nextBucket.previousRegime).toBe('trending');
  });

  it('scores confluence with independent long and short side scores', () => {
    const scorer = new ConfluenceScorer(() => Date.parse('2026-05-03T12:00:00.000Z'));
    const score = scorer.score({
      pair: 'B-BTC_USDT',
      side: 'LONG',
      confidence: 0.9,
      regime: 'trending',
      components: {
        structure: 1,
        momentum: 1,
        microstructure: 0.8,
        risk: 1,
      },
    });
    expect(score.longScore).toBeGreaterThanOrEqual(75);
    expect(score.shortScore).toBeLessThanOrEqual(25);
    expect(score.fireGatePassed).toBe(true);
    expect(scorer.decision('B-BTC_USDT')?.dominantSide).toBe('LONG');
    expect(scorer.current('B-BTC_USDT')?.scoredAt).toBe('2026-05-03T12:00:00.000Z');
  });

  it('applies volatile exception when microstructure contribution is strong', () => {
    const scorer = new ConfluenceScorer(() => Date.parse('2026-05-03T12:00:00.000Z'));
    const score = scorer.score({
      pair: 'B-BTC_USDT',
      side: 'LONG',
      confidence: 1,
      regime: 'volatile',
      components: {
        confidence: 1,
        structure: 1,
        momentum: 1,
        microstructure: 1,
        risk: 1,
      },
      shortComponents: {
        confidence: 1,
        structure: 1,
        momentum: 1,
        microstructure: 1,
        risk: 1,
      },
    });
    const decision = scorer.decision('B-BTC_USDT');
    expect(score.scoreSpread).toBeLessThan(25);
    expect(decision?.shouldFire).toBe(true);
    expect(decision?.volatileExceptionApplied).toBe(true);
  });

  it('maps strategy signals into trade intents via SignalEngine', () => {
    const engine = new SignalEngine();
    const intent = engine.buildTradeIntent({ signal: baseSignal() });
    expect(intent).toEqual(expect.objectContaining({
      strategyId: 'llm.pulse.v1',
      pair: 'B-BTC_USDT',
      side: 'LONG',
      stopLoss: '95',
      takeProfit: '112',
    }));

    const ignored = engine.buildTradeIntent({
      signal: baseSignal({ type: 'strategy.wait', payload: { reason: 'wait', confidence: 0 } }),
    });
    expect(ignored).toBeNull();
  });

  it('evaluates risk decisions and stores latest evaluation', () => {
    const riskManager = new RiskManager(() => Date.parse('2026-05-03T12:00:00.000Z'));
    const signalEngine = new SignalEngine();
    const intent = signalEngine.buildTradeIntent({ signal: baseSignal() });
    expect(intent).not.toBeNull();
    if (!intent) throw new Error('intent should be present');

    const evaluation = riskManager.evaluate({
      intent,
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      options: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(evaluation.decision.approved).toBe(true);
    expect(riskManager.current(intent.pair)?.evaluatedAt).toBe('2026-05-03T12:00:00.000Z');
  });

  it('routes approved intents to paper and tracks history', () => {
    const router = new OrderRouter(() => Date.parse('2026-05-03T12:00:00.000Z'));
    const riskManager = new RiskManager();
    const signalEngine = new SignalEngine();
    const intent = signalEngine.buildTradeIntent({ signal: baseSignal() });
    expect(intent).not.toBeNull();
    if (!intent) throw new Error('intent should be present');

    const decision = riskManager.evaluate({
      intent,
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      options: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(decision.decision.approved).toBe(true);
    if (!decision.decision.approved) throw new Error('intent should be approved');

    const routed = router.route(decision.decision.intent);
    expect(routed.route).toBe('paper');
    expect(router.history()).toHaveLength(1);
  });

  it('tracks position lifecycle transitions per pair', () => {
    const machine = new PositionStateMachine(() => Date.parse('2026-05-03T12:00:00.000Z'));
    expect(machine.transition('B-BTC_USDT', { type: 'scan_started', reason: 'scan' }).state).toBe('SCANNING');
    expect(machine.transition('B-BTC_USDT', { type: 'signal_detected', reason: 'signal' }).state).toBe('SIGNAL_DETECTED');
    expect(machine.transition('B-BTC_USDT', { type: 'entry_validated', reason: 'validated' }).state).toBe('ENTRY_VALIDATED');
    expect(machine.transition('B-BTC_USDT', { type: 'order_placed', reason: 'placed' }).state).toBe('ORDER_PLACED');
    expect(machine.transition('B-BTC_USDT', { type: 'entry_filled', reason: 'fill' }).state).toBe('POSITION_OPEN');
    expect(machine.transition('B-BTC_USDT', { type: 'breakeven_protected', reason: 'be' }).state).toBe('BREAKEVEN_PROTECTED');
    expect(machine.transition('B-BTC_USDT', { type: 'partial_tp_hit', reason: 'tp1' }).state).toBe('PARTIAL_TP_HIT');
    expect(machine.transition('B-BTC_USDT', { type: 'trailing_started', reason: 'trail' }).state).toBe('TRAILING');
    expect(machine.transition('B-BTC_USDT', { type: 'time_stop_kill', reason: 'timeout' }).state).toBe('TIME_STOP_KILL');
    expect(machine.transition('B-BTC_USDT', { type: 'position_closed', reason: 'flat' }).state).toBe('POSITION_CLOSED');
    expect(machine.current('B-BTC_USDT')?.transitionAt).toBe('2026-05-03T12:00:00.000Z');
  });

  it('blocks on confluence gate and keeps pending entries', () => {
    const pipeline = new CoreRuntimePipeline();
    const blocked = pipeline.process(baseSignal(), {
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      regimeFeatures: { adx4h: 30, atrPercentile: 0.3, bbWidthPercentile: 0.3 },
      riskOptions: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(blocked?.status).toBe('blocked');
    if (blocked?.status !== 'blocked') throw new Error('expected blocked decision');
    expect(blocked.reason).toBe('confluence_gate');
    expect(blocked.riskDecision.approved).toBe(false);
    expect(pipeline.pendingIntent('B-BTC_USDT')).toBeDefined();
  });

  it('runs risk-gate and routed paths through CoreRuntimePipeline', () => {
    const pipeline = new CoreRuntimePipeline();
    const blocked = pipeline.process(
      baseSignal({ payload: { confidence: 0.9, reason: 'missing guards' } }),
      {
        market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
        regimeFeatures: { adx4h: 30, atrPercentile: 0.3, bbWidthPercentile: 0.3 },
        confluenceComponents: { structure: 1, momentum: 1, microstructure: 1, risk: 1 },
        riskOptions: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
      },
    );
    expect(blocked?.status).toBe('blocked');
    if (blocked?.status !== 'blocked') throw new Error('expected blocked decision');
    expect(blocked.reason).toBe('risk_gate');
    expect(blocked.riskDecision.approved).toBe(false);
    if (!blocked.riskDecision.approved) {
      expect(blocked.riskDecision.rejections.map((rejection) => rejection.code)).toEqual(
        expect.arrayContaining(['missing_stop_loss', 'missing_take_profit']),
      );
    }

    const routed = pipeline.process(baseSignal(), {
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      regimeFeatures: { adx4h: 29, bbWidthPercentile: 0.3 },
      confluenceComponents: { structure: 1, momentum: 1, microstructure: 1, risk: 1 },
      microstructureContribution: 1,
      riskOptions: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(routed?.status).toBe('routed');
    if (routed?.status !== 'routed') throw new Error('expected routed decision');
    expect(routed.routedOrder.route).toBe('paper');
    expect(routed.routedOrder.intentId).toBe(routed.intent.id);
    expect(routed.routedOrder.entryType).toBe('limit');
    expect(routed.routedOrder.stopLoss).toBe(routed.intent.stopLoss);
    expect(routed.routedOrder.takeProfit).toBe(routed.intent.takeProfit);
    expect(routed.routedOrder.strategyId).toBe(routed.intent.strategyId);
    expect(routed.positionState.state).toBe('ORDER_PLACED');
    expect(routed.tradePlan.side).toBe('LONG');
    expect(routed.tradePlan.targets.tp1).toBeGreaterThan(routed.tradePlan.entry);
    expect(routed.tradePlan.targets.tp2).toBeGreaterThan(routed.tradePlan.targets.tp1);
    expect(routed.tradePlan.metadata.negativeCloseAllowedOnlyBy).toBe('time_stop_kill');
  });

  it('keeps runtime decision payload focused without probability internals', () => {
    const pipeline = new CoreRuntimePipeline();
    const decision = pipeline.process(baseSignal(), {
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      regimeFeatures: { adx4h: 30, atrPercentile: 0.3, bbWidthPercentile: 0.3 },
      confluenceComponents: { structure: 1, momentum: 1, microstructure: 1, risk: 1 },
      microstructureContribution: 1,
      riskOptions: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(decision).toBeTruthy();
    if (!decision) throw new Error('expected decision');
    expect('probability' in decision).toBe(false);
    if (decision.status === 'routed') {
      expect(decision.tradePlan.metadata.highConfluenceGate).toBe(85);
      expect(decision.tradePlan.metadata.negativeCloseAllowedOnlyBy).toBe('time_stop_kill');
    }
  });

  it('cancels pending entries when regime changes on next 5m cadence', () => {
    let nowMs = Date.parse('2026-05-03T12:00:00.000Z');
    const pipeline = new CoreRuntimePipeline({
      regimeClassifier: new RegimeClassifier(() => nowMs),
      confluenceScorer: new ConfluenceScorer(() => nowMs),
      riskManager: new RiskManager(() => nowMs),
      orderRouter: new OrderRouter(() => nowMs),
      positionStateMachine: new PositionStateMachine(() => nowMs),
    });

    const first = pipeline.process(baseSignal(), {
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      regimeFeatures: { adx4h: 30, atrPercentile: 0.3, bbWidthPercentile: 0.3 },
      riskOptions: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(first?.status).toBe('blocked');
    expect(pipeline.pendingIntent('B-BTC_USDT')).toBeDefined();

    nowMs = Date.parse('2026-05-03T12:06:00.000Z');
    const second = pipeline.process(baseSignal({ id: 'sig-2' }), {
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      regimeFeatures: { adx4h: 10, atrPercentile: 0.4, bbWidthPercentile: 0.7 },
      confluenceComponents: { structure: 1, momentum: 1, microstructure: 1, risk: 1 },
      microstructureContribution: 1,
      riskOptions: { nowMs: Date.parse('2026-05-03T12:00:20.000Z') },
    });
    expect(second?.status).toBe('routed');
    if (second?.status !== 'routed') throw new Error('expected routed decision');
    expect(second.pendingEntriesCancelled).toBe(true);
    expect(second.regime.changed).toBe(true);
    expect(second.regime.previousRegime).toBe('trending');
    expect(pipeline.pendingIntent('B-BTC_USDT')).toBeUndefined();
  });
});
