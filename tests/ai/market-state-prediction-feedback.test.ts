import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { MarketStateBuilder } from '../../src/ai/state-builder';
import type { Candle } from '../../src/ai/state-builder';
import type { Config } from '../../src/config/schema';
import type { PredictionFeedback } from '../../src/prediction-outcomes/types';

const emptyFeedback: PredictionFeedback = {
  recent_resolved: [],
  wins_vs_losses: {
    tp_first: 0,
    sl_first: 0,
    ttl_neutral: 0,
    invalid_geometry: 0,
    sample_n: 0,
  },
  adaptive_min_confidence_llm: null,
  adaptive_min_confidence_conductor: null,
};

function mkCandles(n: number): Candle[] {
  const t0 = 1_700_000_000_000;
  return Array.from({ length: n }, (_, i) => ({
    timestamp: t0 + i * 60_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1,
  }));
}

const partialConfig = {
  PREDICTION_FEEDBACK_IN_PROMPT: true,
  PREDICTION_ADAPTIVE_ENABLED: true,
} as unknown as Config;

describe('MarketStateBuilder prediction_feedback', () => {
  it('caches loadFeedbackForPair per pair until TTL expires', async () => {
    let loads = 0;
    const repo = {
      async loadFeedbackForPair() {
        loads += 1;
        return emptyFeedback;
      },
    };
    let now = 1_000_000;
    const logger = { warn: vi.fn(), info: vi.fn() } as any;
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const builder = new MarketStateBuilder(logger, pool, {
      repo,
      config: partialConfig,
      cacheTtlMs: 10_000,
      clock: () => now,
    });
    const htf = mkCandles(35);
    const ltf = mkCandles(20);

    await builder.build(htf, ltf, null, null, [], 'B-BTC_USDT');
    await builder.build(htf, ltf, null, null, [], 'B-BTC_USDT');
    expect(loads).toBe(1);

    now += 11_000;
    await builder.build(htf, ltf, null, null, [], 'B-BTC_USDT');
    expect(loads).toBe(2);
  });

  it('skips feedback when both prompt and adaptive flags are off', async () => {
    let loads = 0;
    const repo = {
      async loadFeedbackForPair() {
        loads += 1;
        return emptyFeedback;
      },
    };
    const logger = { warn: vi.fn(), info: vi.fn() } as any;
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const cfg = {
      PREDICTION_FEEDBACK_IN_PROMPT: false,
      PREDICTION_ADAPTIVE_ENABLED: false,
    } as unknown as Config;
    const builder = new MarketStateBuilder(logger, pool, {
      repo,
      config: cfg,
      cacheTtlMs: 5_000,
    });
    const htf = mkCandles(35);
    const ltf = mkCandles(20);
    const state = await builder.build(htf, ltf, null, null, [], 'B-ETH_USDT');
    expect(loads).toBe(0);
    expect(state?.prediction_feedback).toBeUndefined();
  });

  it('mergePredictionFeedbackWhenConfigured strips recent when prompt off but adaptive on', async () => {
    const repo = {
      async loadFeedbackForPair(): Promise<PredictionFeedback> {
        return {
          recent_resolved: [
            {
              strategy: 'llm.pulse.v1',
              side: 'LONG',
              outcome: 'tp_first',
              resolved_at_iso: '2026-01-01T00:00:00.000Z',
            },
          ],
          wins_vs_losses: {
            tp_first: 1,
            sl_first: 0,
            ttl_neutral: 0,
            invalid_geometry: 0,
            sample_n: 1,
          },
          adaptive_min_confidence_llm: 0.62,
          adaptive_min_confidence_conductor: 0.7,
        };
      },
    };
    const logger = { warn: vi.fn(), info: vi.fn() } as any;
    const cfg = {
      PREDICTION_FEEDBACK_IN_PROMPT: false,
      PREDICTION_ADAPTIVE_ENABLED: true,
    } as unknown as Config;
    const builder = new MarketStateBuilder(logger, undefined, {
      repo,
      config: cfg,
      cacheTtlMs: 60_000,
    });
    const base = {
      symbol: 'B-ETH_USDT',
      current_price: 1,
      htf: { trend: 'range', swing_high: 2, swing_low: 0 },
      ltf: {
        trend: 'range',
        bos: false,
        swing_high: 2,
        swing_low: 0,
        displacement: { present: false, strength: 'weak' as const },
        fvg: [],
        mitigation: { status: 'x', zone: [0, 0] as [number, number] },
        inducement: { present: false },
        premium_discount: 'equilibrium' as const,
      },
      confluence: { aligned: false, narrative: 'n' },
      liquidity: { pools: [], event: 'none' },
      state: { is_trending: false, is_post_sweep: false, is_pre_expansion: false },
    };
    const merged = await builder.mergePredictionFeedbackWhenConfigured(base, 'B-ETH_USDT');
    expect(merged.prediction_feedback?.recent_resolved).toEqual([]);
    expect(merged.prediction_feedback?.wins_vs_losses.sample_n).toBe(0);
    expect(merged.prediction_feedback?.adaptive_min_confidence_llm).toBe(0.62);
    expect(merged.prediction_feedback?.adaptive_min_confidence_conductor).toBe(0.7);
  });
});
