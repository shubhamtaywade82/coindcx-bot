import { describe, it, expect } from 'vitest';
import { OpposingPairCorrelationRule } from '../../../../src/strategy/risk/rules/correlation';
import type { RiskRuleContext } from '../../../../src/strategy/risk/rules/types';

const ctx = (live: any[], side: 'LONG' | 'SHORT' = 'LONG'): RiskRuleContext => ({
  signal: { side, confidence: 0.8, reason: '' },
  manifest: { id: 'a', version: '1', mode: 'interval', intervalMs: 1000, pairs: ['p'], description: '' },
  pair: 'p',
  account: { positions: [], balances: [], orders: [],
    totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } },
  liveSignals: live, now: 1000,
});

describe('OpposingPairCorrelationRule', () => {
  it('blocks LONG when SHORT live on same pair', () => {
    const r = new OpposingPairCorrelationRule(60_000);
    expect(r.apply(ctx([{ strategyId: 'b', pair: 'p', ts: 990, side: 'SHORT' }], 'LONG')).pass).toBe(false);
  });
  it('passes when same-side live exists', () => {
    const r = new OpposingPairCorrelationRule(60_000);
    expect(r.apply(ctx([{ strategyId: 'b', pair: 'p', ts: 990, side: 'LONG' }], 'LONG')).pass).toBe(true);
  });
  it('passes when opposing live on different pair', () => {
    const r = new OpposingPairCorrelationRule(60_000);
    expect(r.apply(ctx([{ strategyId: 'b', pair: 'q', ts: 990, side: 'SHORT' }], 'LONG')).pass).toBe(true);
  });
});
