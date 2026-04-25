import type { AppLogger } from '../logging/logger';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class MarketStateBuilder {
  constructor(private logger: AppLogger) {}

  build(candles: Candle[], orderBook: any, positions: any[]): any {
    if (candles.length < 10) return null;

    const structure = this.analyzeStructure(candles);
    const smc = this.analyzeSMC(candles);
    const liquidity = this.analyzeLiquidity(candles);

    return {
      structure,
      liquidity,
      smc: {
        ...smc,
        premium_discount: this.calculatePremiumDiscount(candles, structure.swing_high, structure.swing_low)
      },
      state: {
        is_trending: structure.trend !== 'range',
        is_range: structure.trend === 'range',
        is_liquidity_event: liquidity.event !== 'none',
        is_post_sweep: liquidity.event === 'sweep',
        is_pre_expansion: smc.displacement.present && !smc.mitigation.status.includes('full')
      },
      time: {
        tf: '15m', // Defaulting for now
        valid_candles: 6,
        expires_at: new Date(Date.now() + 15 * 6 * 60000).toISOString()
      }
    };
  }

  private analyzeStructure(candles: Candle[]) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    
    // Simple Swing detection for POC
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const swing_high = Math.max(...highs.slice(-20));
    const swing_low = Math.min(...lows.slice(-20));

    let trend = 'range';
    if (last.close > swing_high * 0.99) trend = 'uptrend';
    if (last.close < swing_low * 1.01) trend = 'downtrend';

    return {
      trend,
      phase: last.volume > prev.volume ? 'impulse' : 'consolidation',
      bos: last.close > swing_high || last.close < swing_low,
      swing_high,
      swing_low
    };
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
        strength: lastBody > avgBody * 2.5 ? 'strong' : 'weak',
      },
      fvg: fvgs.slice(-3),
      mitigation: {
        status: 'untouched',
        zone: [0, 0]
      },
      inducement: { present: false }
    };
  }

  private analyzeLiquidity(candles: Candle[]) {
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
