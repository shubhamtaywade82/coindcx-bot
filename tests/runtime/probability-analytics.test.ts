import { describe, expect, it, vi } from 'vitest';
import { ProbabilityAnalyticsRepository } from '../../src/runtime/probability-analytics';

describe('ProbabilityAnalyticsRepository', () => {
  it('returns exact regime/score bucket when available', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          regime: 'trending',
          score_bucket_5: 75,
          sample_size: 42,
          p_hit_1r: 0.7,
          p_hit_3r: 0.4,
          p_hit_stop: 0.2,
          expected_r: 1.1,
        }],
      });
    const repo = new ProbabilityAnalyticsRepository({ query } as any);

    const snapshot = await repo.snapshot({ regime: 'trending', maxScore: 76 });

    expect(snapshot).toEqual({
      regime: 'trending',
      scoreBucket5: 75,
      sampleSize: 42,
      pHit1r: 0.7,
      pHit3r: 0.4,
      pHitStop: 0.2,
      expectedR: 1.1,
    });
  });

  it('falls back to nearest bucket when exact missing', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          regime: 'volatile',
          score_bucket_5: 70,
          sample_size: 10,
          p_hit_1r: 0.5,
          p_hit_3r: 0.3,
          p_hit_stop: 0.4,
          expected_r: 0.2,
        }],
      });
    const repo = new ProbabilityAnalyticsRepository({ query } as any);

    const snapshot = await repo.snapshot({ regime: 'volatile', maxScore: 73 });

    expect(snapshot.scoreBucket5).toBe(70);
    expect(snapshot.regime).toBe('volatile');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns neutral fallback when view query errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('view missing'));
    const repo = new ProbabilityAnalyticsRepository({ query } as any);

    const snapshot = await repo.snapshot({ regime: 'ranging', maxScore: 64 });

    expect(snapshot).toEqual({
      regime: 'ranging',
      scoreBucket5: 60,
      sampleSize: 0,
      pHit1r: 0.5,
      pHit3r: 0.5,
      pHitStop: 0.5,
      expectedR: 0,
    });
  });
});
