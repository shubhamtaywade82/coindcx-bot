import { describe, expect, it } from 'vitest';
import type { TradeIntent } from '../../src/execution/trade-intent';
import type { ConfluenceScore } from '../../src/runtime/confluence-scorer';
import { TradePlanEngine } from '../../src/runtime/trade-plan';

function tradeIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    id: 'intent-1',
    strategyId: 'llm.pulse.v1',
    pair: 'B-BTC_USDT',
    side: 'LONG',
    entryType: 'limit',
    entryPrice: '100',
    stopLoss: '95',
    takeProfit: '112',
    confidence: 0.9,
    ttlMs: 60_000,
    createdAt: '2026-05-03T12:00:00.000Z',
    reason: 'test',
    metadata: {},
    ...overrides,
  };
}

function confluence(overrides: Partial<ConfluenceScore> = {}): ConfluenceScore {
  return {
    pair: 'B-BTC_USDT',
    longScore: 90,
    shortScore: 10,
    regime: 'trending',
    components: { confidence: 1, structure: 1, momentum: 1, microstructure: 1, risk: 1 },
    shortComponents: { confidence: -1, structure: -1, momentum: -1, microstructure: -1, risk: -1 },
    maxScore: 90,
    scoreSpread: 80,
    fireGatePassed: true,
    volatileExceptionApplied: false,
    scoredAt: '2026-05-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('TradePlanEngine', () => {
  it('builds trade plan from score dominance and constraints', () => {
    const engine = new TradePlanEngine();
    const plan = engine.compute({
      intent: tradeIntent(),
      confluence: confluence(),
      regime: 'trending',
      market: { markPrice: '100', liquidationPrice: '80', maxLeverage: '25' },
      accountEquity: 10_000,
      riskCapitalFraction: 0.01,
      atrPercent: 0.01,
      feeRate: 0.001,
      fundingRate: 0.0005,
      maxVenueLeverage: 25,
    });

    expect(plan.side).toBe('LONG');
    expect(plan.quantity).toBeGreaterThan(0);
    expect(plan.leverage).toBeLessThanOrEqual(10);
    expect(plan.targets.tp1).toBeGreaterThan(plan.entry);
    expect(plan.targets.tp2).toBeGreaterThan(plan.targets.tp1);
    expect(plan.metadata.negativeCloseAllowedOnlyBy).toBe('time_stop_kill');
  });

  it('uses short side when short score dominates', () => {
    const engine = new TradePlanEngine();
    const plan = engine.compute({
      intent: tradeIntent({ side: 'SHORT', entryPrice: '100', stopLoss: '105', takeProfit: '90' }),
      confluence: confluence({ longScore: 20, shortScore: 85, maxScore: 85, scoreSpread: 65 }),
      regime: 'volatile',
      market: { markPrice: '100', liquidationPrice: '120', maxLeverage: '20' },
      accountEquity: 10_000,
      riskCapitalFraction: 0.01,
      atrPercent: 0.01,
      feeRate: 0.001,
      fundingRate: 0.0005,
      maxVenueLeverage: 20,
    });

    expect(plan.side).toBe('SHORT');
    expect(plan.targets.tp1).toBeLessThan(plan.entry);
    expect(plan.targets.tp2).toBeLessThan(plan.targets.tp1);
  });

  it('flags liquidation buffer violation when distance is insufficient', () => {
    const engine = new TradePlanEngine();
    const plan = engine.compute({
      intent: tradeIntent(),
      confluence: confluence(),
      regime: 'ranging',
      market: { markPrice: '100', liquidationPrice: '96', maxLeverage: '10' },
      accountEquity: 10_000,
      riskCapitalFraction: 0.01,
      atrPercent: 0.01,
      feeRate: 0.001,
      fundingRate: 0.0005,
      maxVenueLeverage: 10,
    });

    expect(plan.liquidationBufferSatisfied).toBe(false);
    expect(plan.violations).toContain('liquidation_buffer_rule_failed');
  });

  it('derives leverage cap from market context when override is absent', () => {
    const engine = new TradePlanEngine();
    const plan = engine.compute({
      intent: tradeIntent(),
      confluence: confluence(),
      regime: 'trending',
      market: { markPrice: '100', liquidationPrice: '80', maxLeverage: '6' },
      accountEquity: 10_000,
      riskCapitalFraction: 0.05,
      atrPercent: 0.01,
      feeRate: 0.001,
      fundingRate: 0.0005,
    });
    expect(plan.leverage).toBeLessThanOrEqual(6);
  });
});
