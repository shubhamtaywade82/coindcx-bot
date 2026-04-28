import type { AppLogger } from '../logging/logger';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  htf: MarketStateHtf;
  ltf: MarketStateLtf;
  confluence: MarketStateConfluence;
  liquidity: MarketStateLiquidity;
  state: MarketStateFlags;
}

export class MarketStateBuilder {
  constructor(private logger: AppLogger) {}

  build(htfCandles: Candle[], ltfCandles: Candle[], _orderBook: unknown, _positions: unknown[]): MarketState | null {
    if (ltfCandles.length < 10) return null;

    const htf = this.analyzeStructure(htfCandles, '1h');
    const ltf = this.analyzeStructure(ltfCandles, '15m');
    const smc = this.analyzeSMC(ltfCandles);
    const liquidity = this.analyzeLiquidity(ltfCandles);

    return {
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
      }
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

  private analyzeLiquidity(_candles: Candle[]) {
    // Simplified Liquidity detection
    return {
      pools: [],
      event: 'none'
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
