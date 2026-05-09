import type { Candle } from '../../ai/state-builder';
import type { LiquidityEngineConfig } from './types';
import type { LiquidityPool } from './types';
import { discoverLiquidityPools } from './swing-pool-discovery';

export class LiquidityPoolRegistry {
  private pools = new Map<string, LiquidityPool[]>();

  getPools(pair: string): LiquidityPool[] {
    return this.pools.get(pair) ?? [];
  }

  /**
   * Refresh pools from closed candle history on each new pool-TF bar close.
   */
  refreshFromClosed(pair: string, closed: Candle[], timeframe: string, cfg: LiquidityEngineConfig): void {
    const discovered = discoverLiquidityPools(closed, timeframe, cfg);
    const previous = this.pools.get(pair) ?? [];
    const merged = discovered
      .map(pool => this.mergePool(pool, previous, cfg))
      .map(pool => (pool.strength < 0.05 ? { ...pool, status: 'invalidated' as const } : pool))
      .filter(pool => pool.strength >= 0.05 && pool.status !== 'invalidated');
    this.pools.set(pair, merged);
  }

  /** Light intrabar decay (optional softening between bar closes). */
  tickDecay(pair: string, cfg: LiquidityEngineConfig): void {
    const list = this.pools.get(pair);
    if (!list) return;
    for (const p of list) {
      if (p.status === 'invalidated') continue;
      p.strength = Math.min(1, p.strength * Math.pow(cfg.poolStrengthDecay, 0.02));
      if (p.strength < 0.12) p.status = 'weakened';
    }
  }

  touchPool(pair: string, poolId: string): void {
    const list = this.pools.get(pair);
    if (!list) return;
    const p = list.find(x => x.id === poolId);
    if (p) {
      p.touches += 1;
      p.strength = Math.max(0.1, p.strength - 0.02 * p.touches);
    }
  }

  private mergePool(pool: LiquidityPool, previous: LiquidityPool[], cfg: LiquidityEngineConfig): LiquidityPool {
    const existing = previous.find(candidate => candidate.id === pool.id) ?? previous.find(candidate => {
      if (candidate.side !== pool.side) return false;
      const mid = (Math.abs(candidate.price) + Math.abs(pool.price)) / 2 || 1;
      return (Math.abs(candidate.price - pool.price) / mid) * 100 <= cfg.equalClusterFloorPct;
    });

    if (!existing) return pool;

    const strength = existing.strength * cfg.poolStrengthDecay;
    return {
      ...pool,
      id: existing.id,
      touches: existing.touches,
      strength,
      status: existing.status === 'weakened' ? 'weakened' : pool.status,
    };
  }
}
