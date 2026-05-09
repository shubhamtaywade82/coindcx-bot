import type { LiquidityEngineConfig } from './types';
import type { LiquidityPool } from './types';
import type { LiquidityRaidEvent } from './types';
import type { SwingIndicators } from '../swing-indicators';

export function isActionableScore(score: number, cfg: LiquidityEngineConfig): boolean {
  return score >= cfg.actionableScoreMin;
}

export function isWatchlistScore(score: number, cfg: LiquidityEngineConfig): boolean {
  return score >= cfg.watchlistScoreMin && score < cfg.actionableScoreMin;
}

export interface ScoreRaidInput {
  pool: LiquidityPool;
  event: LiquidityRaidEvent;
  cfg: LiquidityEngineConfig;
  swing: SwingIndicators;
  displacementOpposite: boolean;
  penetrationSweetSpot: boolean;
  volumeSpike: boolean;
  freshPool: boolean;
}

/**
 * Weighted institutional-style score (tunable via thresholds in caller).
 */
export function scoreRaidEvent(input: ScoreRaidInput): { total: number; breakdown: Record<string, number> } {
  const { pool, event, cfg, swing, displacementOpposite, penetrationSweetSpot, volumeSpike, freshPool } = input;
  const breakdown: Record<string, number> = {};

  if (pool.pivotCount >= 3) breakdown.equalCluster = 2;
  if (penetrationSweetSpot) breakdown.penetration = 2;
  if (volumeSpike) breakdown.volume = 2;
  if (displacementOpposite) breakdown.displacement = 3;
  if (cfg.structureMssBonus) {
    const mss = swing.marketStructureShift.mss;
    if (pool.side === 'buySide' && mss === 'bearish') breakdown.structure = 2;
    else if (pool.side === 'sellSide' && mss === 'bullish') breakdown.structure = 2;
  }
  if (freshPool) breakdown.freshPool = 1;
  if (pool.strength > 0.65) breakdown.poolStrength = 1;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  void event;
  return { total, breakdown };
}
