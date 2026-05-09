import { describe, expect, it } from 'vitest';
import { discoverLiquidityPools, pivotHighLowIndices } from '../../../src/marketdata/liquidity/swing-pool-discovery';
import type { LiquidityEngineConfig } from '../../../src/marketdata/liquidity/types';
import type { Candle } from '../../../src/ai/state-builder';

const baseCfg: LiquidityEngineConfig = {
  enabled: true,
  poolTimeframe: '15m',
  lookbackBars: 80,
  equalClusterFloorPct: 0.15,
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

function candle(ts: number, o: number, h: number, l: number, c: number, v = 100): Candle {
  return { timestamp: ts, open: o, high: h, low: l, close: c, volume: v };
}

describe('swing-pool-discovery', () => {
  it('clusters equal highs into a buySide pool', () => {
    const t0 = 1_700_000_000_000;
    const step = 60_000;
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i += 1) {
      const ts = t0 + i * step;
      let high = 99 + Math.sin(i * 0.4) * 0.4;
      let low = 98.5;
      let close = 99;
      let open = 99;
      if (i === 8 || i === 14) {
        high = 100.02;
        low = 99;
        close = 99.6;
        open = 99.4;
      }
      if (i === 6 || i === 7 || i === 9 || i === 10) {
        high = 99.4;
        low = 98.6;
        close = 99;
        open = 99;
      }
      if (i === 12 || i === 13 || i === 15 || i === 16) {
        high = 99.4;
        low = 98.6;
        close = 99;
        open = 99;
      }
      candles.push(candle(ts, open, high, low, close, 100 + i));
    }
    const closed = candles.slice(0, -1);
    const { highs } = pivotHighLowIndices(closed);
    expect(highs.length).toBeGreaterThanOrEqual(1);

    const pools = discoverLiquidityPools(closed, '15m', baseCfg);
    const buy = pools.filter(p => p.side === 'buySide');
    expect(buy.length).toBeGreaterThanOrEqual(1);
  });

  it('does not emit pools from insufficient history', () => {
    const few: Candle[] = [candle(0, 1, 1.1, 0.9, 1, 10), candle(1, 1, 1.1, 0.9, 1, 10)];
    const pools = discoverLiquidityPools(few, '15m', baseCfg);
    expect(pools).toHaveLength(0);
  });
});
