import { describe, it, expect } from 'vitest';
import { PredictionOutcomeRepository } from '../../src/prediction-outcomes/repository';
import type { Signal } from '../../src/signals/types';

function signal(over: Partial<Signal>): Signal {
  return {
    id: 's1',
    ts: new Date().toISOString(),
    strategy: 'smc.rule.v1',
    type: 'strategy.long',
    pair: 'B-BTC_USDT',
    severity: 'warn',
    payload: {},
    ...over,
  };
}

describe('PredictionOutcomeRepository', () => {
  it('shouldTrack accepts smc when entry sl tp are finite', () => {
    const s = signal({
      payload: { entry: 100, stopLoss: 99, takeProfit: 102, confidence: 0.7 },
    });
    expect(PredictionOutcomeRepository.shouldTrack(s)).toBe(true);
  });

  it('shouldTrack rejects missing tp', () => {
    const s = signal({
      payload: { entry: 100, stopLoss: 99 },
    });
    expect(PredictionOutcomeRepository.shouldTrack(s)).toBe(false);
  });

  it('shouldTrack rejects untracked strategy', () => {
    const s = signal({
      strategy: 'unknown.v1',
      payload: { entry: 1, stopLoss: 0, takeProfit: 2 },
    });
    expect(PredictionOutcomeRepository.shouldTrack(s)).toBe(false);
  });

  it('buildFeatureSnapshot copies safe fields', () => {
    const snap = PredictionOutcomeRepository.buildFeatureSnapshot(
      signal({
        payload: {
          entry: 1,
          confidence: 0.55,
          reason: 'x'.repeat(3000),
          manifestVersion: '1.0.0',
          meta: { rr: 2 },
        },
      }),
    );
    expect(snap.strategy).toBe('smc.rule.v1');
    expect(snap.confidence).toBe(0.55);
    expect(String(snap.reason).length).toBeLessThanOrEqual(2000);
    expect(snap.meta).toEqual({ rr: 2 });
  });
});
