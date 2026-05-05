import { describe, it, expect, vi } from 'vitest';
import { LlmPulse, alignStopTakeToSide } from '../../../src/strategy/strategies/llm-pulse';

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

  it('corrects SHORT when model returns LONG-style sl<entry<tp (swapped sl/tp labels)', async () => {
    const s = new LlmPulse(fakeAnalyzer({
      verdict: 'bearish',
      signal: 'SHORT',
      confidence: 0.8,
      setup: { entry: '83.59', sl: '83.5', tp: '84.5', rr: 99 },
    }));
    const r = await s.evaluate(baseCtx);
    expect(r?.side).toBe('SHORT');
    expect(parseFloat(r?.stopLoss!)).toBeGreaterThan(83.59);
    expect(parseFloat(r?.takeProfit!)).toBeLessThan(83.59);
    expect(r?.meta?.levelGeometryCorrected).toBe(true);
    expect(Number(r?.meta?.rr)).toBeCloseTo((83.59 - parseFloat(r.takeProfit!)) / (parseFloat(r.stopLoss!) - 83.59), 5);
  });

  it('corrects LONG when model returns SHORT-style tp<entry<sl', async () => {
    const s = new LlmPulse(fakeAnalyzer({
      verdict: 'bullish',
      signal: 'LONG',
      confidence: 0.7,
      setup: { entry: '100', sl: '105', tp: '95', rr: 1 },
    }));
    const r = await s.evaluate(baseCtx);
    expect(r?.side).toBe('LONG');
    expect(parseFloat(r?.stopLoss!)).toBeLessThan(100);
    expect(parseFloat(r?.takeProfit!)).toBeGreaterThan(100);
    expect(r?.meta?.levelGeometryCorrected).toBe(true);
  });
});

describe('alignStopTakeToSide', () => {
  it('leaves valid SHORT geometry unchanged', () => {
    const o = alignStopTakeToSide('SHORT', 100, 105, 92);
    expect(o).toEqual({ sl: 105, tp: 92, swapped: false });
  });

  it('swaps LONG-labeled prices when side is SHORT', () => {
    const o = alignStopTakeToSide('SHORT', 83.59, 83.5, 84.5);
    expect(o.swapped).toBe(true);
    expect(o.tp).toBeLessThan(83.59);
    expect(o.sl).toBeGreaterThan(83.59);
  });
});
