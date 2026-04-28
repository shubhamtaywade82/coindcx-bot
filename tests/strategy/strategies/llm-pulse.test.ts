import { describe, it, expect, vi } from 'vitest';
import { LlmPulse } from '../../../src/strategy/strategies/llm-pulse';

const fakeAnalyzer = (resp: any) => ({ analyze: vi.fn().mockResolvedValue(resp) }) as any;

const baseCtx: any = {
  ts: 1, pair: 'B-BTC_USDT',
  marketState: { htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 }, ltf: {}, confluence: {}, liquidity: {}, state: {} },
  account: { positions: [], balances: [], orders: [], totals: {} },
  recentFills: [], trigger: { kind: 'interval' },
};

describe('LlmPulse', () => {
  it('maps analyzer response to StrategySignal', async () => {
    const s = new LlmPulse(fakeAnalyzer({
      verdict: 'long pulse', signal: 'LONG', confidence: 0.85,
      setup: { entry: '50000', sl: '49000', tp: '52000', rr: 2 },
      no_trade_condition: undefined,
    }));
    const r = await s.evaluate(baseCtx);
    expect(r?.side).toBe('LONG');
    expect(r?.confidence).toBe(0.85);
    expect(r?.entry).toBe('50000');
    expect(r?.stopLoss).toBe('49000');
    expect(r?.takeProfit).toBe('52000');
  });

  it('returns WAIT on analyzer failure shape', async () => {
    const s = new LlmPulse(fakeAnalyzer({
      verdict: 'unavailable', signal: 'WAIT', confidence: 0,
      no_trade_condition: 'Connectivity issue',
    }));
    const r = await s.evaluate(baseCtx);
    expect(r?.side).toBe('WAIT');
    expect(r?.noTradeCondition).toBe('Connectivity issue');
  });

  it('clamps confidence to [0, 1]', async () => {
    const s = new LlmPulse(fakeAnalyzer({ signal: 'LONG', confidence: 1.7, verdict: '' }));
    const r = await s.evaluate(baseCtx);
    expect(r?.confidence).toBe(1);
  });
});
