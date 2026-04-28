import { describe, it, expect } from 'vitest';
import { PerPairCooldownRule } from '../../../../src/strategy/risk/rules/cooldown';
import type { RiskRuleContext } from '../../../../src/strategy/risk/rules/types';

const ctx = (now: number): RiskRuleContext => ({
  signal: { side: 'LONG', confidence: 0.8, reason: '' },
  manifest: { id: 'a', version: '1', mode: 'interval', intervalMs: 1000, pairs: ['p'], description: '' },
  pair: 'p',
  account: { positions: [], balances: [], orders: [],
    totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } },
  liveSignals: [], now,
});

describe('PerPairCooldownRule', () => {
  it('passes when no prior emit', () => {
    expect(new PerPairCooldownRule(1000).apply(ctx(1000)).pass).toBe(true);
  });
  it('blocks within cooldown window', () => {
    const r = new PerPairCooldownRule(1000);
    r.recordEmit('a', 'p', 'LONG', 500);
    expect(r.apply(ctx(900)).pass).toBe(false);
  });
  it('passes after cooldown window', () => {
    const r = new PerPairCooldownRule(1000);
    r.recordEmit('a', 'p', 'LONG', 500);
    expect(r.apply(ctx(1600)).pass).toBe(true);
  });
});
