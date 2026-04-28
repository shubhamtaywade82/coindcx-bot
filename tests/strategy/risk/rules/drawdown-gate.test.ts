import { describe, it, expect } from 'vitest';
import { DrawdownGateRule } from '../../../../src/strategy/risk/rules/drawdown-gate';
import type { RiskRuleContext } from '../../../../src/strategy/risk/rules/types';

const ctx = (equity: string): RiskRuleContext => ({
  signal: { side: 'LONG', confidence: 0.8, reason: '' },
  manifest: { id: 'a', version: '1', mode: 'interval', intervalMs: 1000, pairs: ['p'], description: '' },
  pair: 'p',
  account: { positions: [], balances: [], orders: [],
    totals: { equityInr: equity, walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } },
  liveSignals: [], now: 1000,
});

describe('DrawdownGateRule', () => {
  it('passes on first call (no peak yet)', () => {
    expect(new DrawdownGateRule(0.10).apply(ctx('1000')).pass).toBe(true);
  });
  it('passes when equity within drawdown limit', () => {
    const r = new DrawdownGateRule(0.10);
    r.apply(ctx('1000'));
    expect(r.apply(ctx('950')).pass).toBe(true);
  });
  it('blocks when drawdown exceeds limit', () => {
    const r = new DrawdownGateRule(0.10);
    r.apply(ctx('1000'));
    const d = r.apply(ctx('850'));
    expect(d.pass).toBe(false);
    expect(d.reason).toMatch(/drawdown/i);
  });
  it('updates peak on new high', () => {
    const r = new DrawdownGateRule(0.10);
    r.apply(ctx('1000'));
    r.apply(ctx('1200'));
    expect(r.currentPeak()).toBe(1200);
    expect(r.apply(ctx('1100')).pass).toBe(true);
    expect(r.apply(ctx('1000')).pass).toBe(false);
  });
});
