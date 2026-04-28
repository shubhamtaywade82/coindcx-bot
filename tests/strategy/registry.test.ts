import { describe, it, expect } from 'vitest';
import { StrategyRegistry } from '../../src/strategy/registry';
import type { Strategy, StrategyManifest } from '../../src/strategy/types';

function makeStrategy(id: string, pairs: string[], cloneable = false): Strategy {
  const manifest: StrategyManifest = { id, version: '1', mode: 'interval', intervalMs: 1000, pairs, description: id };
  const instance: Strategy = {
    manifest,
    evaluate: () => null,
  };
  if (cloneable) {
    instance.clone = () => ({ manifest, evaluate: () => null });
  }
  return instance;
}

describe('StrategyRegistry', () => {
  it('registers and lists', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    expect(r.list().map(m => m.id)).toEqual(['a']);
  });

  it('rejects duplicate id', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    expect(() => r.register(makeStrategy('a', ['B-BTC_USDT']))).toThrow(/duplicate/i);
  });

  it('per-pair instances when pairs.length > 1 and clone exists', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT', 'B-ETH_USDT'], true));
    const i1 = r.instance('a', 'B-BTC_USDT');
    const i2 = r.instance('a', 'B-ETH_USDT');
    expect(i1).toBeDefined();
    expect(i2).toBeDefined();
    expect(i1).not.toBe(i2);
  });

  it('throws if multi-pair without clone', () => {
    const r = new StrategyRegistry();
    expect(() => r.register(makeStrategy('a', ['B-BTC_USDT', 'B-ETH_USDT'], false))).toThrow(/clone/i);
  });

  it('enable/disable gates evaluations', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    expect(r.enabled('a')).toBe(true);
    r.disable('a');
    expect(r.enabled('a')).toBe(false);
    r.enable('a');
    expect(r.enabled('a')).toBe(true);
  });

  it('performance counters increment', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    r.recordEmit('a');
    r.recordEmit('a');
    r.recordError('a');
    expect(r.performance('a')).toEqual(expect.objectContaining({
      signalsEmitted: 2, errors: 1, lastSignalAt: expect.any(Number),
    }));
  });
});
