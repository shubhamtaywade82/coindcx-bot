import { describe, it, expect } from 'vitest';
import { PerStrategyMaxPositionsRule } from '../../../../src/strategy/risk/rules/per-strategy-max-positions';
import type { RiskRuleContext } from '../../../../src/strategy/risk/rules/types';

const ctx = (live: any[]): RiskRuleContext => ({
  signal: { side: 'LONG', confidence: 0.8, reason: '' },
  manifest: { id: 'a', version: '1', mode: 'interval', intervalMs: 1000, pairs: ['p'], description: '' },
  pair: 'p',
  account: { positions: [], balances: [], orders: [],
    totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } },
  liveSignals: live, now: 1000,
});

describe('PerStrategyMaxPositionsRule', () => {
  it('blocks when strategy already at cap', () => {
    const r = new PerStrategyMaxPositionsRule(1, 60_000);
    expect(r.apply(ctx([{ strategyId: 'a', pair: 'p', ts: 990, side: 'LONG' }])).pass).toBe(false);
  });
  it('ignores other strategies', () => {
    const r = new PerStrategyMaxPositionsRule(1, 60_000);
    expect(r.apply(ctx([{ strategyId: 'b', pair: 'p', ts: 990, side: 'LONG' }])).pass).toBe(true);
  });
});
