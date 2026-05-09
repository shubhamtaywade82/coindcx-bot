import type { Candle } from '../../ai/state-builder';
import type { LiquidityEngineConfig } from './types';
import type { LiquidityPool, LiquidityPoolSide } from './types';

function trueRange(a: Candle, b: Candle): number {
  const hl = a.high - a.low;
  const hc = Math.abs(a.high - b.close);
  const lc = Math.abs(a.low - b.close);
  return Math.max(hl, hc, lc);
}

/** ATR% = ATR / lastClose * 100 */
export function atrPercentFromClosed(closed: Candle[], period = 14): number {
  if (closed.length < period + 1) return 0.1;
  const slice = closed.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i += 1) {
    sum += trueRange(slice[i - 1]!, slice[i]!);
  }
  const atr = sum / period;
  const lastClose = closed[closed.length - 1]!.close;
  if (!Number.isFinite(lastClose) || lastClose <= 0) return 0.1;
  return (atr / lastClose) * 100;
}

/** Pivot highs/lows on fully closed candles (index 2..len-3). */
export function pivotHighLowIndices(closed: Candle[]): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  if (closed.length < 5) return { highs, lows };
  for (let i = 2; i <= closed.length - 3; i += 1) {
    const prev2 = closed[i - 2]!;
    const prev1 = closed[i - 1]!;
    const curr = closed[i]!;
    const next1 = closed[i + 1]!;
    const next2 = closed[i + 2]!;
    if (
      curr.high > prev1.high &&
      curr.high > prev2.high &&
      curr.high > next1.high &&
      curr.high > next2.high
    ) {
      highs.push(i);
    }
    if (
      curr.low < prev1.low &&
      curr.low < prev2.low &&
      curr.low < next1.low &&
      curr.low < next2.low
    ) {
      lows.push(i);
    }
  }
  return { highs, lows };
}

function clusterPrices(
  indices: number[],
  closed: Candle[],
  mode: 'high' | 'low',
  thresholdPct: number,
): number[][] {
  const prices = indices.map(i => (mode === 'high' ? closed[i]!.high : closed[i]!.low));
  const clusters: number[][] = [];
  const used = new Set<number>();
  for (let a = 0; a < indices.length; a += 1) {
    if (used.has(a)) continue;
    const group: number[] = [indices[a]!];
    used.add(a);
    const pa = prices[a]!;
    for (let b = a + 1; b < indices.length; b += 1) {
      if (used.has(b)) continue;
      const pb = prices[b]!;
      const mid = (Math.abs(pa) + Math.abs(pb)) / 2 || 1;
      if ((Math.abs(pa - pb) / mid) * 100 <= thresholdPct) {
        group.push(indices[b]!);
        used.add(b);
      }
    }
    clusters.push(group);
  }
  return clusters;
}

function makePoolId(side: LiquidityPoolSide, price: number): string {
  return `${side}-${price.toFixed(6)}`;
}

function clusterCenterPrice(indices: number[], closed: Candle[], mode: 'high' | 'low'): number {
  const prices = indices.map(i => (mode === 'high' ? closed[i]!.high : closed[i]!.low));
  return prices.reduce((acc, price) => acc + price, 0) / prices.length;
}

/**
 * Build liquidity pools from **closed** candles only (caller passes slice without forming bar).
 */
export function discoverLiquidityPools(
  closed: Candle[],
  timeframe: string,
  cfg: LiquidityEngineConfig,
): LiquidityPool[] {
  if (closed.length < 10) return [];
  const lookback = Math.min(closed.length, cfg.lookbackBars);
  const slice = closed.slice(-lookback);
  const atrPct = atrPercentFromClosed(slice, 14);
  const thresholdPct = Math.max(cfg.equalClusterFloorPct, atrPct * cfg.equalClusterAtrMult);

  const { highs, lows } = pivotHighLowIndices(slice);
  const highClusters = clusterPrices(highs, slice, 'high', thresholdPct);
  const lowClusters = clusterPrices(lows, slice, 'low', thresholdPct);

  const pools: LiquidityPool[] = [];

  for (const idxs of highClusters) {
    if (idxs.length < 2) continue;
    const price = clusterCenterPrice(idxs, slice, 'high');
    const createdAtBarTs = Math.max(...idxs.map(i => slice[i]!.timestamp));
    const side: LiquidityPoolSide = 'buySide';
    pools.push({
      id: makePoolId(side, price),
      side,
      price,
      createdAtBarTs,
      strength: Math.min(1, 0.5 + idxs.length * 0.1),
      touches: 0,
      timeframe,
      status: 'active',
      pivotCount: idxs.length,
    });
  }

  for (const idxs of lowClusters) {
    if (idxs.length < 2) continue;
    const price = clusterCenterPrice(idxs, slice, 'low');
    const createdAtBarTs = Math.max(...idxs.map(i => slice[i]!.timestamp));
    const side: LiquidityPoolSide = 'sellSide';
    pools.push({
      id: makePoolId(side, price),
      side,
      price,
      createdAtBarTs,
      strength: Math.min(1, 0.5 + idxs.length * 0.1),
      touches: 0,
      timeframe,
      status: 'active',
      pivotCount: idxs.length,
    });
  }

  pools.sort((a, b) => b.strength - a.strength);
  return pools.slice(0, cfg.maxPoolsPerPair);
}
