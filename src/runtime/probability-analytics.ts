import type { Pool } from 'pg';
import type { MarketRegime } from './regime-classifier';

export interface ProbabilityBlock {
  regime: MarketRegime;
  scoreBucket5: number;
  sampleSize: number;
  pHit1r: number;
  pHit3r: number;
  pHitStop: number;
  expectedR: number;
}

export interface ProbabilitySnapshot extends ProbabilityBlock {}

export interface ProbabilityLookupInput {
  regime: MarketRegime;
  maxScore: number;
}

interface ProbabilityRow {
  regime: string;
  score_bucket_5: number;
  sample_size: number;
  p_hit_1r: number;
  p_hit_3r: number;
  p_hit_stop: number;
  expected_r: number;
}

const KNOWN_REGIMES: ReadonlySet<MarketRegime> = new Set([
  'unknown',
  'trending',
  'compressed',
  'ranging',
  'volatile',
]);

function normalizeScoreBucket(score: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return Math.floor(clamped / 5) * 5;
}

function isMarketRegime(value: string): value is MarketRegime {
  return KNOWN_REGIMES.has(value as MarketRegime);
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function clampExpectedR(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(3, value));
}

export class ProbabilityAnalyticsRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async snapshot(input: ProbabilityLookupInput): Promise<ProbabilitySnapshot> {
    const scoreBucket5 = normalizeScoreBucket(input.maxScore);
    try {
      const exact = await this.queryOne(input.regime, scoreBucket5);
      if (exact) return exact;

      const nearest = await this.queryNearest(input.regime, scoreBucket5);
      if (nearest) return nearest;
    } catch {
      // Runtime path should keep flowing even when analytics view is unavailable.
    }

    return this.fallback(input.regime, scoreBucket5);
  }

  private async queryOne(regime: MarketRegime, scoreBucket5: number): Promise<ProbabilityBlock | null> {
    const result = await this.pool.query(
      `SELECT regime, score_bucket_5, sample_size, p_hit_1r, p_hit_3r, p_hit_stop, expected_r
       FROM probability_of_profit_by_regime_score
       WHERE regime = $1 AND score_bucket_5 = $2`,
      [regime, scoreBucket5],
    );
    const row = result.rows[0] as ProbabilityRow | undefined;
    return row ? this.toBlock(row) : null;
  }

  private async queryNearest(regime: MarketRegime, scoreBucket5: number): Promise<ProbabilityBlock | null> {
    const result = await this.pool.query(
      `SELECT regime, score_bucket_5, sample_size, p_hit_1r, p_hit_3r, p_hit_stop, expected_r
       FROM probability_of_profit_by_regime_score
       WHERE regime = $1
       ORDER BY ABS(score_bucket_5 - $2), score_bucket_5 DESC
       LIMIT 1`,
      [regime, scoreBucket5],
    );
    const row = result.rows[0] as ProbabilityRow | undefined;
    return row ? this.toBlock(row) : null;
  }

  private toBlock(row: ProbabilityRow): ProbabilityBlock {
    const regime = isMarketRegime(row.regime) ? row.regime : 'unknown';
    return {
      regime,
      scoreBucket5: row.score_bucket_5,
      sampleSize: row.sample_size,
      pHit1r: clampProbability(row.p_hit_1r),
      pHit3r: clampProbability(row.p_hit_3r),
      pHitStop: clampProbability(row.p_hit_stop),
      expectedR: clampExpectedR(row.expected_r),
    };
  }

  private fallback(regime: MarketRegime, scoreBucket5: number): ProbabilitySnapshot {
    return {
      regime,
      scoreBucket5,
      sampleSize: 0,
      pHit1r: 0.5,
      pHit3r: 0.5,
      pHitStop: 0.5,
      expectedR: 0,
    };
  }
}
