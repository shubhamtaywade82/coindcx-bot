import type { AppLogger } from '../logging/logger';
import type { Pool } from 'pg';
import type { FusionSnapshot } from '../marketdata/coindcx-fusion';
import { displacementFromCandles } from '../marketdata/displacement';
import type { Config } from '../config/schema';
import type { PredictionOutcomeRepository } from '../prediction-outcomes/repository';
import type { PredictionFeedback } from '../prediction-outcomes/types';

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

export interface MarketStateLiquidityRaid {
  lastScore: number;
  actionable: boolean;
  watchlistQuality: boolean;
  side: 'buySide' | 'sellSide';
  atMs: number;
}

export interface MarketStateLiquidity {
  pools: Array<{ type: 'high' | 'low'; price: number; age: number }>;
  event: 'none' | 'sweep' | 'raid_confirmed' | string;
  raid?: MarketStateLiquidityRaid;
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
  /** Filled at runtime when prediction outcome tracking injects calibration context. */
  prediction_feedback?: PredictionFeedback;
}

/** Optional Postgres-backed calibration context (cached per pair). */
export interface MarketStateBuilderPredictionDeps {
  repo: Pick<PredictionOutcomeRepository, 'loadFeedbackForPair'>;
  config: Config;
  cacheTtlMs: number;
  clock?: () => number;
}

export class MarketStateBuilder {
  private readonly predictionFeedbackCache = new Map<
    string,
    { feedback: PredictionFeedback; expiresAtMs: number }
  >();

  constructor(
    private logger: AppLogger,
    private pool?: Pool,
    private predictionDeps?: MarketStateBuilderPredictionDeps,
  ) {}

  async build(
    htfCandles: Candle[],
    ltfCandles: Candle[],
    bookSnapshot: BookSnapshot | null,
    fusion: FusionSnapshot | null,
    positions: any[],
    pair?: string,
  ): Promise<MarketState | null> {
    if (ltfCandles.length < 10) return null;

    const cleanKey = (s?: string): string =>
      String(s ?? '').toUpperCase().replace(/^B-/, '').replace(/_/g, '');
    const targetClean = cleanKey(pair);
    const activePos = positions.find(p => {
      if (!p) return false;
      if (Math.abs(parseFloat(p.activePos ?? p.active_pos ?? '0')) === 0) return false;
      if (p.pair === pair) return true;
      return cleanKey(p.pair) === targetClean;
    });
    const positionData = activePos ? {
      side: (activePos.side ?? (parseFloat(activePos.activePos ?? activePos.active_pos ?? '0') > 0 ? 'long' : 'short')) as 'long' | 'short' | 'flat',
      entry: parseFloat(activePos.avgPrice ?? activePos.avg_price ?? '0'),
      unrealized_pnl: parseFloat(activePos.unrealizedPnl ?? activePos.unrealized_pnl ?? '0'),
      size: Math.abs(parseFloat(activePos.activePos ?? activePos.active_pos ?? '0')),
    } : undefined;

    const htf = this.analyzeStructure(htfCandles, '1h');
    const ltf = this.analyzeStructure(ltfCandles, '15m');
    const smc = this.analyzeSMC(ltfCandles);
    const liquidity = this.buildLiquidity(ltfCandles, fusion);

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

    const base: MarketState = {
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
        premium_discount: this.calculatePremiumDiscount(ltfCandles, ltf.swing_high, ltf.swing_low),
      },
      confluence: {
        aligned: htf.trend === ltf.trend,
        narrative: this.generateNarrative(htf.trend, ltf.trend, liquidity.event, liquidity.raid?.side),
      },
      liquidity,
      state: {
        is_trending: ltf.trend !== 'range',
        is_post_sweep: this.isPostSweepLiquidity(liquidity, fusion),
        is_pre_expansion: smc.displacement.present && !smc.mitigation.status.includes('full'),
      },
      ...(bookSnapshot ? { book: bookSnapshot } : {}),
      position: positionData,
      pine_signals,
      fusion: fusion ?? undefined,
    };

    return await this.mergePredictionFeedbackWhenConfigured(base, pair);
  }

  /** Exposed for tests; production path is `build()`. */
  async mergePredictionFeedbackWhenConfigured(base: MarketState, pair?: string): Promise<MarketState> {
    const p = pair?.trim();
    if (!p || !this.predictionDeps) return base;

    const { config, repo, cacheTtlMs, clock = Date.now } = this.predictionDeps;
    if (!config.PREDICTION_FEEDBACK_IN_PROMPT && !config.PREDICTION_ADAPTIVE_ENABLED) return base;

    try {
      const prediction_feedback = await this.getPredictionFeedbackCached(p, repo, config, cacheTtlMs, clock);
      if (!config.PREDICTION_FEEDBACK_IN_PROMPT && config.PREDICTION_ADAPTIVE_ENABLED) {
        return {
          ...base,
          prediction_feedback: {
            recent_resolved: [],
            wins_vs_losses: {
              tp_first: 0,
              sl_first: 0,
              ttl_neutral: 0,
              invalid_geometry: 0,
              sample_n: 0,
            },
            adaptive_min_confidence_llm: prediction_feedback.adaptive_min_confidence_llm,
            adaptive_min_confidence_conductor: prediction_feedback.adaptive_min_confidence_conductor,
          },
        };
      }
      return { ...base, prediction_feedback };
    } catch (err: any) {
      this.logger.warn({ mod: 'state', err: err?.message, pair: p }, 'prediction feedback load failed');
      return base;
    }
  }

  private async getPredictionFeedbackCached(
    pair: string,
    repo: Pick<PredictionOutcomeRepository, 'loadFeedbackForPair'>,
    config: Config,
    cacheTtlMs: number,
    clock: () => number,
  ): Promise<PredictionFeedback> {
    const now = clock();
    const hit = this.predictionFeedbackCache.get(pair);
    if (hit && hit.expiresAtMs > now) return hit.feedback;

    const feedback = await repo.loadFeedbackForPair(pair, config);
    this.predictionFeedbackCache.set(pair, { feedback, expiresAtMs: now + cacheTtlMs });
    return feedback;
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

  private generateNarrative(
    htfTrend: string,
    ltfTrend: string,
    liqEvent: string,
    raidSide?: 'buySide' | 'sellSide',
  ) {
    if (htfTrend === ltfTrend) return `Strong ${htfTrend} momentum confirmed across timeframes.`;
    if (liqEvent === 'sweep') return `Counter-trend sweep detected. Potential reversal in play.`;
    if (liqEvent === 'raid_confirmed') {
      const sideLabel = raidSide === 'sellSide' ? 'Sell-side' : 'Buy-side';
      return `${sideLabel} liquidity raid: rejection + opposite displacement (engine).`;
    }
    return `Timeframe divergence. HTF ${htfTrend} vs LTF ${ltfTrend}. Exercise caution.`;
  }

  private buildLiquidity(ltfCandles: Candle[], fusion: FusionSnapshot | null): MarketStateLiquidity {
    const raid = fusion?.liquidityRaid;
    if (raid?.enabled) {
      const lc = raid.lastConfirmed;
      const pools: MarketStateLiquidity['pools'] = raid.pools.map(p => ({
        type: p.side === 'buySide' ? 'high' : 'low',
        price: p.price,
        age: 0,
      }));
      const sweepish =
        lc &&
        lc.outcome === 'reversalCandidate' &&
        (lc.actionable || lc.watchlistQuality);
      return {
        pools,
        event: sweepish ? 'raid_confirmed' : 'none',
        raid: lc
          ? {
              lastScore: lc.score,
              actionable: lc.actionable,
              watchlistQuality: lc.watchlistQuality,
              side: lc.side,
              atMs: lc.atMs,
            }
          : undefined,
      };
    }
    const legacy = this.analyzeLiquidity(ltfCandles);
    return {
      pools: legacy.pools,
      event: legacy.event === 'sweep' ? 'sweep' : 'none',
    };
  }

  private isPostSweepLiquidity(liquidity: MarketStateLiquidity, fusion: FusionSnapshot | null): boolean {
    if (fusion?.liquidityRaid?.enabled) {
      const lc = fusion.liquidityRaid.lastConfirmed;
      if (lc && lc.outcome === 'reversalCandidate' && (lc.actionable || lc.watchlistQuality)) {
        const anchor = fusion.generatedAt ?? Date.now();
        return anchor - lc.atMs < 3_600_000;
      }
      return false;
    }
    return liquidity.event === 'sweep';
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

    const disp = displacementFromCandles(candles, 10);

    return {
      displacement: {
        present: disp.present,
        strength: disp.strength,
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
