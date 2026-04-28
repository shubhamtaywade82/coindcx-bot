import { describe, it, expect } from 'vitest';
import { MaxConcurrentSignalsRule } from '../../../../src/strategy/risk/rules/max-concurrent-signals';
import type { RiskRuleContext } from '../../../../src/strategy/risk/rules/types';

const baseCtx = (live: any[]): RiskRuleContext => ({
  signal: { side: 'LONG', confidence: 0.8, reason: '' },
  manifest: { id: 'a', version: '1', mode: 'interval', intervalMs: 1000, pairs: ['p'], description: '' },
  pair: 'p',
  account: { positions: [], balances: [], orders: [],
    totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } },
  liveSignals: live, now: 1000,
});

describe('MaxConcurrentSignalsRule', () => {
  it('passes under cap', () => {
    const r = new MaxConcurrentSignalsRule(3, 60_000);
    expect(r.apply(baseCtx([{ strategyId: 'a', pair: 'p', ts: 990, side: 'LONG' }])).pass).toBe(true);
  });
  it('blocks at cap', () => {
    const r = new MaxConcurrentSignalsRule(2, 60_000);
    const d = r.apply(baseCtx([
      { strategyId: 'a', pair: 'p', ts: 990, side: 'LONG' },
      { strategyId: 'b', pair: 'q', ts: 950, side: 'SHORT' },
    ]));
    expect(d.pass).toBe(false);
  });
  it('expired (out of window) live signals do not count', () => {
    const r = new MaxConcurrentSignalsRule(1, 100);
    expect(r.apply(baseCtx([{ strategyId: 'a', pair: 'p', ts: 800, side: 'LONG' }])).pass).toBe(true);
  });
});
