import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { StrategyController } from '../../src/strategy/controller';
import { PassthroughRiskFilter } from '../../src/strategy/risk/risk-filter';
import type { Strategy, StrategyManifest } from '../../src/strategy/types';

const fakeMarket: any = {
  htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
  ltf: { trend: 'uptrend', bos: true, swing_high: 1, swing_low: 0,
    displacement: { present: true, strength: 'strong' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0,0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};

const fakeAccount: any = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

function makeStrategy(id: string, pairs: string[], evalImpl: () => any): Strategy {
  const manifest: StrategyManifest = { id, version: '1', mode: 'interval', intervalMs: 100, pairs, description: '' };
  return { manifest, evaluate: evalImpl };
}

const baseDeps = () => {
  const ws = new EventEmitter();
  const bus = { emit: vi.fn().mockResolvedValue(undefined) };
  return {
    ws: ws as any,
    signalBus: bus as any,
    riskFilter: new PassthroughRiskFilter(),
    buildMarketState: () => fakeMarket,
    candleProvider: { ltf: () => [], htf: () => [] },
    fusionProvider: () => null,
    accountSnapshot: () => fakeAccount,
    recentFills: () => [],
    extractPair: (raw: any) => raw?.pair,
    config: {
      timeoutMs: 1000, errorThreshold: 3, emitWait: false,
      backpressureDropRatioAlarm: 0.5,
    },
    clock: () => 1234,
  };
};

describe('StrategyController', () => {
  it('emits a signal through the pipeline', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['B-BTC_USDT'], () => ({ side: 'LONG', confidence: 0.9, reason: 'ok' })));
    await ctrl.runOnce('a', 'B-BTC_USDT', { kind: 'interval' });
    expect(deps.signalBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      strategy: 'a', type: 'strategy.long', pair: 'B-BTC_USDT',
    }));
  });

  it('notifies evaluated signals before risk filtering', async () => {
    const deps = baseDeps();
    const onEvaluatedSignal = vi.fn();
    const ctrl = new StrategyController({
      ...deps,
      onEvaluatedSignal,
      riskFilter: { filter: vi.fn().mockReturnValue(null) },
    });
    ctrl.register(makeStrategy('a', ['B-BTC_USDT'], () => ({ side: 'LONG', confidence: 0.9, reason: 'ok' })));
    await ctrl.runOnce('a', 'B-BTC_USDT', { kind: 'interval' });
    expect(onEvaluatedSignal).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'LONG', confidence: 0.9, reason: 'ok' }),
      expect.objectContaining({ id: 'a' }),
      'B-BTC_USDT',
    );
    expect(deps.signalBus.emit).not.toHaveBeenCalled();
  });

  it('uses manifest-specific evaluation timeout when present', async () => {
    vi.useFakeTimers();
    try {
      const deps = baseDeps();
      const ctrl = new StrategyController(deps);
      const manifest: StrategyManifest = {
        id: 'slow',
        version: '1',
        mode: 'interval',
        intervalMs: 100,
        evaluationTimeoutMs: 50,
        pairs: ['B-BTC_USDT'],
        description: '',
      };
      ctrl.register({
        manifest,
        evaluate: () => new Promise(resolve => setTimeout(() => resolve({ side: 'LONG', confidence: 0.9, reason: 'late' }), 100)),
      });

      const run = ctrl.runOnce('slow', 'B-BTC_USDT', { kind: 'interval' });
      await vi.advanceTimersByTimeAsync(51);
      await run;

      expect(deps.signalBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        strategy: 'slow',
        type: 'strategy.error',
        payload: expect.objectContaining({ error: 'strategy timeout after 50ms' }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit WAIT by default', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['B-BTC_USDT'], () => ({ side: 'WAIT', confidence: 0, reason: 'no' })));
    await ctrl.runOnce('a', 'B-BTC_USDT', { kind: 'interval' });
    expect(deps.signalBus.emit).not.toHaveBeenCalled();
  });

  it('survives strategy throw and counts errors', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['p'], () => { throw new Error('boom'); }));
    await ctrl.runOnce('a', 'p', { kind: 'interval' });
    expect(ctrl.registry.performance('a')!.errors).toBe(1);
    expect(ctrl.registry.enabled('a')).toBe(true);
  });

  it('auto-disables after errorThreshold consecutive errors per pair', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['p'], () => { throw new Error('boom'); }));
    for (let i = 0; i < 3; i++) await ctrl.runOnce('a', 'p', { kind: 'interval' });
    expect(ctrl.registry.enabled('a')).toBe(false);
    const types = deps.signalBus.emit.mock.calls.map((c: any) => c[0].type);
    expect(types).toContain('strategy.disabled');
  });

  it('clamps confidence and rejects malformed signal', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['p'], () => ({ side: 'BOGUS', confidence: 5, reason: '' })));
    await ctrl.runOnce('a', 'p', { kind: 'interval' });
    const types = deps.signalBus.emit.mock.calls.map((c: any) => c[0].type);
    expect(types).not.toContain('strategy.long');
    expect(types).not.toContain('strategy.short');
    expect(types).toContain('strategy.error');
    expect(ctrl.registry.performance('a')!.errors).toBe(1);
  });
});
