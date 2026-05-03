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
    expect(classifyRegime({ bbWidthPercentile: 0.1, atrPercentile: 0.9 })).toBe('compressed');
    expect(classifyRegime({ adx4h: 10, atrPercentile: 0.4, bbWidthPercentile: 0.7 })).toBe('ranging');
    expect(classifyRegime({ adx4h: 22, atrPercentile: 0.9, bbWidthPercentile: 0.8 })).toBe('volatile');
  });

  it('stores classifier snapshots by pair', () => {
    const classifier = new RegimeClassifier(() => Date.parse('2026-05-03T12:00:00.000Z'));
    const snapshot = classifier.classify('B-BTC_USDT', { adx4h: 30 });
    expect(snapshot.regime).toBe('trending');
    expect(classifier.current('B-BTC_USDT')?.classifiedAt).toBe('2026-05-03T12:00:00.000Z');
  });

  it('scores confluence using side and regime', () => {
    const scorer = new ConfluenceScorer(() => Date.parse('2026-05-03T12:00:00.000Z'));
    const score = scorer.score({
      pair: 'B-BTC_USDT',
      side: 'LONG',
      confidence: 0.8,
      regime: 'trending',
    });
    expect(score.longScore).toBe(80);
    expect(score.shortScore).toBe(20);
    expect(scorer.current('B-BTC_USDT')?.scoredAt).toBe('2026-05-03T12:00:00.000Z');
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
    expect(machine.transition('B-BTC_USDT', { type: 'intent_routed', reason: 'intent sent' }).state).toBe('entry_submitted');
    expect(machine.transition('B-BTC_USDT', { type: 'entry_filled', reason: 'fill' }).state).toBe('entry_filled');
    expect(machine.transition('B-BTC_USDT', { type: 'exit_submitted', reason: 'exit sent' }).state).toBe('exit_submitted');
    expect(machine.transition('B-BTC_USDT', { type: 'position_closed', reason: 'position flat' }).state).toBe('closed');
    expect(machine.current('B-BTC_USDT')?.transitionAt).toBe('2026-05-03T12:00:00.000Z');
  });

  it('runs blocked and routed paths through CoreRuntimePipeline', () => {
    const pipeline = new CoreRuntimePipeline();
    const blocked = pipeline.process(
      baseSignal({ payload: { confidence: 0.9, reason: 'missing guards' } }),
      {
        market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      },
    );
    expect(blocked?.status).toBe('blocked');
    if (blocked?.status !== 'blocked') throw new Error('expected blocked decision');
    expect(blocked.riskDecision.approved).toBe(false);
    if (!blocked.riskDecision.approved) {
      expect(blocked.riskDecision.rejections.map((rejection) => rejection.code)).toEqual(
        expect.arrayContaining(['missing_stop_loss', 'missing_take_profit']),
      );
    }

    const routed = pipeline.process(baseSignal(), {
      market: { markPrice: '100', marketDataFresh: true, accountStateFresh: true },
      regimeFeatures: { adx4h: 29, bbWidthPercentile: 0.3 },
      riskOptions: { nowMs: Date.parse('2026-05-03T12:00:10.000Z') },
    });
    expect(routed?.status).toBe('routed');
    if (routed?.status !== 'routed') throw new Error('expected routed decision');
    expect(routed.routedOrder.route).toBe('paper');
    expect(routed.positionState.state).toBe('entry_submitted');
  });
});
