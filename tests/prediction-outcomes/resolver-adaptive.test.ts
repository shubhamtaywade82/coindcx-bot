import { describe, it, expect, vi } from 'vitest';
import { PredictionOutcomeResolver } from '../../src/prediction-outcomes/resolver';
import type { Config } from '../../src/config/schema';
import type { Candle } from '../../src/ai/state-builder';

const BAR_MS_15M = 15 * 60 * 1000;

const config = {
  PREDICTION_OUTCOME_ENABLED: true,
} as unknown as Config;

describe('PredictionOutcomeResolver adaptive refresh', () => {
  it('does not call refreshAdaptiveForStrategy when resolved strategy is not LLM', async () => {
    const signalMs = 1_700_000_000_000;
    const refresh = vi.fn();
    const markResolved = vi.fn();
    const repo = {
      listPending: async () => [
        {
          id: 1,
          client_signal_id: 'c1',
          strategy: 'smc.rule.v1',
          pair: 'B-BTC_USDT',
          signal_ts: new Date(signalMs),
          side: 'LONG' as const,
          entry: '100',
          stop_loss: '99',
          take_profit: '102',
          ttl_ms: String(24 * 60 * 60 * 1000),
        },
      ],
      markResolved,
      refreshAdaptiveForStrategy: refresh,
    };

    const bars: Candle[] = [
      {
        timestamp: signalMs,
        open: 100,
        high: 103,
        low: 99.5,
        close: 102,
        volume: 1,
      },
    ];

    const nowMs = signalMs + BAR_MS_15M + 60_000;
    const resolver = new PredictionOutcomeResolver({
      repo: repo as any,
      config,
      logger: { warn: vi.fn(), info: vi.fn() } as any,
      getBars15m: () => bars,
      clock: () => nowMs,
    });

    await resolver.tick();
    expect(markResolved).toHaveBeenCalledWith(1, 'tp_first', expect.any(Number));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('calls refreshAdaptiveForStrategy for llm.pulse after tp_first', async () => {
    const signalMs = 1_700_000_100_000;
    const refresh = vi.fn();
    const repo = {
      listPending: async () => [
        {
          id: 2,
          client_signal_id: 'c2',
          strategy: 'llm.pulse.v1',
          pair: 'B-BTC_USDT',
          signal_ts: new Date(signalMs),
          side: 'LONG' as const,
          entry: '100',
          stop_loss: '99',
          take_profit: '102',
          ttl_ms: String(24 * 60 * 60 * 1000),
        },
      ],
      markResolved: vi.fn(),
      refreshAdaptiveForStrategy: refresh,
    };

    const bars: Candle[] = [
      {
        timestamp: signalMs,
        open: 100,
        high: 103,
        low: 99.5,
        close: 102,
        volume: 1,
      },
    ];
    const nowMs = signalMs + BAR_MS_15M + 60_000;
    const resolver = new PredictionOutcomeResolver({
      repo: repo as any,
      config,
      logger: { warn: vi.fn(), info: vi.fn() } as any,
      getBars15m: () => bars,
      clock: () => nowMs,
    });

    await resolver.tick();
    expect(refresh).toHaveBeenCalledWith('B-BTC_USDT', 'llm.pulse.v1', config);
  });
});
