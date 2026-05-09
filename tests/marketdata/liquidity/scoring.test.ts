import { describe, expect, it } from 'vitest';
import { isActionableScore, isWatchlistScore, scoreRaidEvent } from '../../../src/marketdata/liquidity/scoring';
import type { LiquidityEngineConfig } from '../../../src/marketdata/liquidity/types';
import type { LiquidityRaidEvent } from '../../../src/marketdata/liquidity/types';
import type { LiquidityPool } from '../../../src/marketdata/liquidity/types';
import type { SwingIndicators } from '../../../src/marketdata/swing-indicators';

const cfg: LiquidityEngineConfig = {
  enabled: true,
  poolTimeframes: ['15m'],
  lookbackBars: 48,
  equalClusterFloorPct: 0.1,
  equalClusterAtrMult: 0.25,
  poolStrengthDecay: 0.95,
  maxPoolsPerPair: 12,
  minPenetrationPct: 0.05,
  maxPenetrationPct: 0.4,
  penetrationAtrScale: 1,
  velocityWindowMs: 800,
  velocityMinPctPerSec: 0.10,
  volumeSpikeMult: 1.5,
  volumeLookbackBars: 10,
  maxRejectionBars: 5,
  acceptanceHoldBars: 2,
  eventMaxAgeMs: 3_600_000,
  eventMaxBarsSinceSweep: 8,
  actionableScoreMin: 8,
  watchlistScoreMin: 5,
  structureMssBonus: true,
};

const swingStub = {
  marketStructureShift: { trend: 'range' as const, mss: 'bearish' as const, lastSwingHigh: 0, lastSwingLow: 0 },
  dailyWeeklyPivots: { daily: null, weekly: null },
  emaBiasFilter: { ema50: 0, ema200: 0, bias: 'neutral' as const },
  fundingRateExtremes: { extreme: 'none' as const },
  oiPriceTruthTable: { classification: 'neutral' as const },
  spotFuturesBasis: { state: 'flat' as const },
  btcDominanceCorrelationFilter: { isAlt: false, filter: 'allow' as const, reason: '' },
} satisfies SwingIndicators;

describe('liquidity scoring', () => {
  it('classifies actionable vs watchlist scores', () => {
    expect(isActionableScore(8, cfg)).toBe(true);
    expect(isWatchlistScore(6, cfg)).toBe(true);
    expect(isWatchlistScore(8, cfg)).toBe(false);
  });

  it('awards displacement and MSS when inputs match', () => {
    const pool: LiquidityPool = {
      id: '15m:buySide-100.000000',
      side: 'buySide',
      price: 100,
      createdAtBarTs: 0,
      strength: 0.8,
      touches: 0,
      timeframe: '15m',
      status: 'active',
      pivotCount: 3,
    };
    const event: LiquidityRaidEvent = {
      id: 'e1',
      poolId: pool.id,
      state: 'swept',
      outcome: 'undetermined',
      score: 0,
      scoreBreakdown: {},
      confirmed: false,
      reclaimed: false,
      rejectionSeen: true,
      barsSinceSweep: 1,
      consecutiveAcceptanceBars: 0,
      createdAtMs: 0,
      updatedAtMs: 0,
    };
    const { total } = scoreRaidEvent({
      pool,
      event,
      cfg,
      swing: swingStub,
      displacementOpposite: true,
      penetrationSweetSpot: true,
      volumeSpike: true,
      freshPool: true,
    });
    expect(total).toBeGreaterThanOrEqual(8);
  });
});
