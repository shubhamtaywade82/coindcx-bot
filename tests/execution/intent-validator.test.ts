import { describe, expect, it } from 'vitest';
import { tradeIntentFromSignal, type TradeIntent } from '../../src/execution/trade-intent';
import { validateTradeIntent } from '../../src/execution/intent-validator';

const nowMs = Date.parse('2026-04-29T10:00:00.000Z');
const createdAt = new Date(nowMs - 1_000).toISOString();

function baseIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    id: 'intent-1',
    strategyId: 'test.strategy',
    pair: 'B-BTC_USDT',
    side: 'LONG',
    entryType: 'limit',
    entryPrice: '100',
    stopLoss: '95',
    takeProfit: '112',
    confidence: 0.8,
    ttlMs: 60_000,
    createdAt,
    reason: 'valid setup',
    ...overrides,
  };
}

function codes(decision: ReturnType<typeof validateTradeIntent>): string[] {
  return decision.approved ? [] : decision.rejections.map(r => r.code);
}

describe('tradeIntentFromSignal', () => {
  it('maps LONG/SHORT strategy signals into trade intents', () => {
    const intent = tradeIntentFromSignal({
      strategyId: 'llm.pulse.v1',
      pair: 'B-BTC_USDT',
      createdAt,
      signal: {
        side: 'LONG',
        confidence: 0.9,
        entry: '100',
        stopLoss: '95',
        takeProfit: '112',
        reason: 'long setup',
        ttlMs: 60_000,
        meta: { rr: 2.4 },
      },
    });

    expect(intent).toEqual(expect.objectContaining({
      strategyId: 'llm.pulse.v1',
      pair: 'B-BTC_USDT',
      side: 'LONG',
      entryPrice: '100',
      stopLoss: '95',
      takeProfit: '112',
      metadata: expect.objectContaining({ rr: 2.4 }),
    }));
  });

  it('does not create a trade intent for WAIT signals', () => {
    const intent = tradeIntentFromSignal({
      strategyId: 'llm.pulse.v1',
      pair: 'B-BTC_USDT',
      createdAt,
      signal: { side: 'WAIT', confidence: 0, reason: 'no trade' },
    });
    expect(intent).toBeNull();
  });
});

describe('validateTradeIntent', () => {
  it('approves a valid LONG setup', () => {
    const decision = validateTradeIntent({
      intent: baseIntent(),
      market: { bestBid: '99.95', bestAsk: '100.05', marketDataFresh: true, accountStateFresh: true },
      options: { nowMs },
    });

    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.intent.metrics.rewardRisk).toBeCloseTo(2.4);
      expect(decision.intent.metrics.spreadPct).toBeCloseTo(0.001);
    }
  });

  it('approves a valid SHORT setup', () => {
    const decision = validateTradeIntent({
      intent: baseIntent({ side: 'SHORT', entryPrice: '100', stopLoss: '105', takeProfit: '88' }),
      options: { nowMs },
    });

    expect(decision.approved).toBe(true);
    if (decision.approved) expect(decision.intent.metrics.rewardRisk).toBeCloseTo(2.4);
  });

  it('can resolve market entries from mark price', () => {
    const decision = validateTradeIntent({
      intent: baseIntent({ entryType: 'market', entryPrice: undefined }),
      market: { markPrice: '100' },
      options: { nowMs },
    });

    expect(decision.approved).toBe(true);
    if (decision.approved) expect(decision.intent.resolvedEntryPrice).toBe('100');
  });

  it('rejects missing protective levels', () => {
    const decision = validateTradeIntent({
      intent: baseIntent({ stopLoss: '', takeProfit: '' }),
      options: { nowMs },
    });

    expect(codes(decision)).toEqual(expect.arrayContaining(['missing_stop_loss', 'missing_take_profit']));
  });

  it('rejects invalid LONG and SHORT level ordering', () => {
    const longDecision = validateTradeIntent({
      intent: baseIntent({ stopLoss: '101', takeProfit: '112' }),
      options: { nowMs },
    });
    const shortDecision = validateTradeIntent({
      intent: baseIntent({ side: 'SHORT', stopLoss: '95', takeProfit: '88' }),
      options: { nowMs },
    });

    expect(codes(longDecision)).toContain('invalid_long_levels');
    expect(codes(shortDecision)).toContain('invalid_short_levels');
  });

  it('rejects expired intents', () => {
    const decision = validateTradeIntent({
      intent: baseIntent({ createdAt: new Date(nowMs - 61_000).toISOString(), ttlMs: 60_000 }),
      options: { nowMs },
    });

    expect(codes(decision)).toContain('expired_intent');
  });

  it('rejects low reward:risk and invalid stop distances', () => {
    const lowRr = validateTradeIntent({
      intent: baseIntent({ stopLoss: '95', takeProfit: '104' }),
      options: { nowMs, minRewardRisk: 1.5 },
    });
    const tooSmallStop = validateTradeIntent({
      intent: baseIntent({ stopLoss: '99.99', takeProfit: '101' }),
      options: { nowMs, minStopDistancePct: 0.001 },
    });
    const tooLargeStop = validateTradeIntent({
      intent: baseIntent({ stopLoss: '70', takeProfit: '170' }),
      options: { nowMs, maxStopDistancePct: 0.1 },
    });

    expect(codes(lowRr)).toContain('reward_risk_too_low');
    expect(codes(tooSmallStop)).toContain('stop_distance_too_small');
    expect(codes(tooLargeStop)).toContain('stop_distance_too_large');
  });

  it('rejects wide spread and stale or divergent state', () => {
    const decision = validateTradeIntent({
      intent: baseIntent(),
      market: {
        bestBid: '99',
        bestAsk: '101',
        marketDataFresh: false,
        accountStateFresh: false,
        accountDivergent: true,
      },
      options: { nowMs, maxSpreadPct: 0.001 },
    });

    expect(codes(decision)).toEqual(expect.arrayContaining([
      'spread_too_wide',
      'market_data_stale',
      'account_state_stale',
      'account_divergent',
    ]));
  });

  it('rejects malformed runtime input', () => {
    const decision = validateTradeIntent({
      intent: baseIntent({
        pair: '',
        side: 'WAIT' as any,
        entryType: 'stop' as any,
        entryPrice: 'nope',
        confidence: 1.5,
        ttlMs: 0,
        createdAt: 'invalid-date',
      }),
      options: { nowMs },
    });

    expect(codes(decision)).toEqual(expect.arrayContaining([
      'missing_pair',
      'invalid_side',
      'invalid_entry_type',
      'missing_entry_price',
      'invalid_confidence',
      'invalid_ttl',
      'invalid_created_at',
    ]));
  });
});
