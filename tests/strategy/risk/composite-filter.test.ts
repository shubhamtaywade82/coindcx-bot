import { describe, it, expect, vi } from 'vitest';
import { CompositeRiskFilter } from '../../../src/strategy/risk/composite-filter';
import { MinConfidenceRule } from '../../../src/strategy/risk/rules/min-confidence';
import { MaxConcurrentSignalsRule } from '../../../src/strategy/risk/rules/max-concurrent-signals';
import { PerPairCooldownRule } from '../../../src/strategy/risk/rules/cooldown';
import type { StrategyManifest, StrategySignal } from '../../../src/strategy/types';
import type { AccountSnapshot } from '../../../src/account/types';

const manifest: StrategyManifest = {
  id: 'a', version: '1', mode: 'interval', intervalMs: 1000,
  pairs: ['B-BTC_USDT'], description: '',
};
const account: AccountSnapshot = { positions: [], balances: [], orders: [],
  totals: { equityInr: '1000', walletInr: '1000', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

function setup(now = 1000) {
  const bus = { emit: vi.fn().mockResolvedValue(undefined) };
  const filter = new CompositeRiskFilter({
    rules: [new MinConfidenceRule(0.5), new MaxConcurrentSignalsRule(2, 60_000), new PerPairCooldownRule(500)],
    signalBus: bus as any,
    emitAlerts: true,
    liveTtlDefaultMs: 60_000,
    clock: () => now,
    pairResolver: (_s, m) => m.pairs[0]!,
  });
  return { filter, bus, setNow: (n: number) => (now = n) };
}

describe('CompositeRiskFilter', () => {
  it('passes valid signal and tracks live', () => {
    const { filter } = setup(1000);
    const sig: StrategySignal = { side: 'LONG', confidence: 0.8, reason: 'r', ttlMs: 60_000 };
    expect(filter.filter(sig, manifest, account)).toBe(sig);
    expect(filter.liveSnapshot()).toHaveLength(1);
  });

  it('blocks low-confidence signal and emits risk.blocked', async () => {
    const { filter, bus } = setup(1000);
    const sig: StrategySignal = { side: 'LONG', confidence: 0.3, reason: 'r', ttlMs: 60_000 };
    expect(filter.filter(sig, manifest, account)).toBeNull();
    await new Promise(r => setImmediate(r));
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'risk.blocked' }));
  });

  it('cooldown blocks repeated emit within window', () => {
    const { filter } = setup(1000);
    const sig: StrategySignal = { side: 'LONG', confidence: 0.8, reason: 'r', ttlMs: 60_000 };
    expect(filter.filter(sig, manifest, account)).toBe(sig);
    expect(filter.filter(sig, manifest, account)).toBeNull();
  });

  it('expires live signals past ttl', () => {
    let now = 1000;
    const filter = new CompositeRiskFilter({
      rules: [new MaxConcurrentSignalsRule(1, 60_000)],
      emitAlerts: false, liveTtlDefaultMs: 100,
      clock: () => now, pairResolver: (_s, m) => m.pairs[0]!,
    });
    const sig: StrategySignal = { side: 'LONG', confidence: 0.8, reason: 'r' };
    expect(filter.filter(sig, manifest, account)).toBe(sig);
    expect(filter.liveSnapshot()).toHaveLength(1);
    now = 1500;
    const sig2: StrategySignal = { side: 'LONG', confidence: 0.8, reason: 'r', ttlMs: 100 };
    expect(filter.filter(sig2, manifest, account)).toBe(sig2);
  });

  it('passes WAIT through without recording live or running blocking rules', () => {
    const { filter, bus } = setup(1000);
    const sig: StrategySignal = { side: 'WAIT', confidence: 0, reason: 'no' };
    expect(filter.filter(sig, manifest, account)).toBe(sig);
    expect(filter.liveSnapshot()).toHaveLength(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });
});
