import type { AppLogger } from '../logging/logger';
import type { Pool } from 'pg';
import type { FusionSnapshot } from '../marketdata/coindcx-fusion';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BookSnapshot {
  bestBid: number;
  bestAsk: number;
  spread: number;
  bidDepth1pct: number;
  askDepth1pct: number;
  imbalance: 'bid-heavy' | 'ask-heavy' | 'neutral';
  bidWallPrice: number | null;
  askWallPrice: number | null;
}

export interface MarketStateHtf {
  trend: string;
  swing_high: number;
  swing_low: number;
}

export interface MarketStateLtf {
  trend: string;
  bos: boolean;
  swing_high: number;
  swing_low: number;
  displacement: { present: boolean; strength: 'weak' | 'strong' };
  fvg: Array<{ type: 'bullish' | 'bearish'; gap: [number, number]; filled: boolean }>;
  mitigation: { status: string; zone: [number, number] };
  inducement: { present: boolean };
  premium_discount: 'premium' | 'discount' | 'equilibrium';
}

export interface MarketStateConfluence {
  aligned: boolean;
  narrative: string;
}

export interface MarketStateLiquidity {
  pools: unknown[];
  event: string;
}

export interface MarketStateFlags {
  is_trending: boolean;
  is_post_sweep: boolean;
  is_pre_expansion: boolean;
}

export interface MarketState {
  symbol: string;
  current_price: number;
  htf: MarketStateHtf;
  ltf: MarketStateLtf;
  confluence: MarketStateConfluence;
  liquidity: MarketStateLiquidity;
  state: MarketStateFlags;
  book?: BookSnapshot;
  position?: {
    side: 'long' | 'short' | 'flat';
    entry: number;
    unrealized_pnl: number;
    size: number;
  };
  pine_signals?: any[];
  fusion?: FusionSnapshot;
}

export class MarketStateBuilder {
  constructor(private logger: AppLogger, private pool?: Pool) {}

  async build(
    htfCandles: Candle[],
    ltfCandles: Candle[],
    bookSnapshot: BookSnapshot | null,
    fusion: FusionSnapshot | null,
    positions: any[],
    pair?: string,
  ): Promise<MarketState | null> {
    if (ltfCandles.length < 10) return null;

    const activePos = positions.find(p => p.pair === pair);
    const positionData = activePos ? {
      side: activePos.side as 'long' | 'short' | 'flat',
      entry: parseFloat(activePos.avgPrice),
      unrealized_pnl: parseFloat(activePos.unrealizedPnl),
      size: Math.abs(parseFloat(activePos.activePos))
    } : undefined;

    const htf = this.analyzeStructure(htfCandles, '1h');
    const ltf = this.analyzeStructure(ltfCandles, '15m');
    const smc = this.analyzeSMC(ltfCandles);
    const liquidity = this.analyzeLiquidity(ltfCandles);

    let pine_signals: any[] = [];
    if (this.pool && pair) {
      try {
        const res = await this.pool.query(
          'SELECT type, strategy, severity, payload FROM signal_log WHERE pair = $1 AND ts > (NOW() - INTERVAL \'4 hours\') ORDER BY ts DESC LIMIT 5',
          [pair]
        );
        pine_signals = res.rows;
      } catch (err: any) {
        this.logger.warn({ mod: 'state', err: err.message }, 'Failed to fetch recent pine signals');
      }
    }

    return {
      symbol: pair || 'unknown',
      current_price: ltfCandles[ltfCandles.length - 1].close,
      htf: {
        trend: htf.trend,
        swing_high: htf.swing_high,
        swing_low: htf.swing_low,
      },
      ltf: {
        ...ltf,
        ...smc,
        premium_discount: this.calculatePremiumDiscount(ltfCandles, ltf.swing_high, ltf.swing_low)
      },
      confluence: {
        aligned: htf.trend === ltf.trend,
        narrative: this.generateNarrative(htf.trend, ltf.trend, liquidity.event)
      },
      liquidity,
      state: {
        is_trending: ltf.trend !== 'range',
        is_post_sweep: liquidity.event === 'sweep',
        is_pre_expansion: smc.displacement.present && !smc.mitigation.status.includes('full')
      },
      ...(bookSnapshot ? { book: bookSnapshot } : {}),
      position: positionData,
      pine_signals,
      fusion: fusion ?? undefined
    };
  }

  private analyzeStructure(candles: Candle[], tf: string) {
    if (candles.length === 0) return { trend: 'unknown', bos: false, swing_high: 0, swing_low: 0 };
    const last = candles[candles.length - 1];
    
    // Use slightly larger window for HTF
    const window = tf === '1h' ? 30 : 20;
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const swing_high = Math.max(...highs.slice(-window));
    const swing_low = Math.min(...lows.slice(-window));

    let trend = 'range';
    if (last.close > swing_high * 0.995) trend = 'uptrend';
    if (last.close < swing_low * 1.005) trend = 'downtrend';

    return {
      trend,
      bos: last.close > swing_high || last.close < swing_low,
      swing_high,
      swing_low
    };
  }

  private generateNarrative(htfTrend: string, ltfTrend: string, liqEvent: string) {
    if (htfTrend === ltfTrend) return `Strong ${htfTrend} momentum confirmed across timeframes.`;
    if (liqEvent === 'sweep') return `Counter-trend sweep detected. Potential reversal in play.`;
    return `Timeframe divergence. HTF ${htfTrend} vs LTF ${ltfTrend}. Exercise caution.`;
  }

  private analyzeSMC(candles: Candle[]) {
    // FVG Detection (3-candle imbalance)
    const fvgs = [];
    for (let i = candles.length - 10; i < candles.length - 1; i++) {
      const c1 = candles[i - 1];
      const c2 = candles[i];
      const c3 = candles[i + 1];
      if (!c1 || !c2 || !c3) continue;

      if (c1.high < c3.low) {
        fvgs.push({ type: 'bullish', gap: [c1.high, c3.low], filled: false });
      } else if (c1.low > c3.high) {
        fvgs.push({ type: 'bearish', gap: [c3.high, c1.low], filled: false });
      }
    }

    // Displacement (Strong move detection)
    const lastBody = Math.abs(candles[candles.length - 1].close - candles[candles.length - 1].open);
    const avgBody = candles.slice(-10).reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / 10;

    return {
      displacement: {
        present: lastBody > avgBody * 1.5,
        strength: (lastBody > avgBody * 2.5 ? 'strong' : 'weak') as 'strong' | 'weak',
      },
      fvg: fvgs.slice(-3) as Array<{ type: 'bullish' | 'bearish'; gap: [number, number]; filled: boolean }>,
      mitigation: {
        status: 'untouched',
        zone: [0, 0] as [number, number],
      },
      inducement: { present: false },
    };
  }

  private analyzeLiquidity(candles: Candle[]) {
    const pools: Array<{ type: 'high' | 'low'; price: number; age: number }> = [];
    const window = 40;
    const slice = candles.slice(-window);
    
    // Find significant local highs/lows
    for (let i = 2; i < slice.length - 2; i++) {
      const prev2 = slice[i - 2];
      const prev1 = slice[i - 1];
      const curr = slice[i];
      const next1 = slice[i + 1];
      const next2 = slice[i + 2];

      if (curr.high > prev1.high && curr.high > prev2.high && curr.high > next1.high && curr.high > next2.high) {
        pools.push({ type: 'high', price: curr.high, age: slice.length - i });
      }
      if (curr.low < prev1.low && curr.low < prev2.low && curr.low < next1.low && curr.low < next2.low) {
        pools.push({ type: 'low', price: curr.low, age: slice.length - i });
      }
    }

    // Sort by age and limit
    const sortedPools = pools.sort((a, b) => a.age - b.age).slice(0, 5);

    return {
      pools: sortedPools,
      event: pools.some(p => p.age < 5) ? 'sweep' : 'none'
    };
  }

  private calculatePremiumDiscount(candles: Candle[], high: number, low: number) {
    const last = candles[candles.length - 1].close;
    const mid = (high + low) / 2;
    if (last > mid * 1.02) return 'premium';
    if (last < mid * 0.98) return 'discount';
    return 'equilibrium';
  }
}
