import { describe, it, expect } from 'vitest';
import { MinConfidenceRule } from '../../../../src/strategy/risk/rules/min-confidence';
import type { RiskRuleContext } from '../../../../src/strategy/risk/rules/types';

const baseCtx = (signal: any, conf: number): RiskRuleContext => ({
  signal: { side: signal, confidence: conf, reason: '' },
  manifest: { id: 'x', version: '1', mode: 'interval', intervalMs: 1000, pairs: ['p'], description: '' },
  pair: 'p',
  account: { positions: [], balances: [], orders: [],
    totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } },
  liveSignals: [], now: 1000,
});

describe('MinConfidenceRule', () => {
  it('passes WAIT regardless of confidence', () => {
    expect(new MinConfidenceRule(0.5).apply(baseCtx('WAIT', 0)).pass).toBe(true);
  });
  it('passes when above threshold', () => {
    expect(new MinConfidenceRule(0.5).apply(baseCtx('LONG', 0.6)).pass).toBe(true);
  });
  it('blocks when below threshold', () => {
    const d = new MinConfidenceRule(0.5).apply(baseCtx('LONG', 0.3));
    expect(d.pass).toBe(false);
    expect(d.reason).toMatch(/0.3.*0.5/);
  });
});
