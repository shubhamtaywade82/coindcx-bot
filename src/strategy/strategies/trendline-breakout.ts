import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';
import type { Candle } from '../../ai/state-builder';

interface Trendline {
  startTime: number;
  startPrice: number;
  slope: number;
}

function computeAtr(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  let trSum = 0;
  const start = candles.length - period;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    trSum += tr;
  }
  return trSum / period;
}

function computeZband(candles: Candle[], atrPeriod: number): number {
  const atr = computeAtr(candles, atrPeriod);
  const price = candles[candles.length - 1]!.close;
  return Math.min(atr * 0.3, price * 0.003) / 2;
}

function trendValue(t: Trendline, time: number): number {
  return t.startPrice + (time - t.startTime) * t.slope;
}

const MANIFEST: StrategyManifest = {
  id: 'trendline.breakout.v1',
  version: '1.0.0',
  mode: 'bar_close',
  barTimeframes: ['1m'],
  pairs: ['*'],
  warmupCandles: 50,
  description: 'Pivot-based dynamic trendlines with ATR-scaled TP/SL and single-trade lifecycle',
};

export class TrendlineBreakout implements Strategy {
  manifest = MANIFEST;

  private readonly pivotPeriod: number;
  private readonly atrPeriod: number;

  // Per-instance state — registry calls clone() per pair so instance vars are safe
  private upperTrend: Trendline | null = null;
  private lowerTrend: Trendline | null = null;
  private tradeOn = false;
  private isLong = false;
  private tp = 0;
  private sl = 0;

  constructor(opts: { pivotPeriod?: number; atrPeriod?: number } = {}) {
    this.pivotPeriod = opts.pivotPeriod ?? 10;
    this.atrPeriod   = opts.atrPeriod   ?? 30;
  }

  clone(): Strategy {
    return new TrendlineBreakout({ pivotPeriod: this.pivotPeriod, atrPeriod: this.atrPeriod });
  }

  evaluate(ctx: StrategyContext): StrategySignal | null {
    const candles = (ctx.fusion?.candles as Record<string, Candle[]> | undefined)?.['1m'];
    if (!candles || candles.length < 50) return null;

    const zband = computeZband(candles, this.atrPeriod);
    this.detectPivots(candles);

    const latest = candles[candles.length - 1]!;

    if (this.tradeOn) {
      const exited = this.manageTrade(latest);
      if (exited) {
        return {
          side: 'WAIT',
          confidence: 0,
          reason: this.isLong ? 'long trade closed (TP/SL)' : 'short trade closed (TP/SL)',
        };
      }
      return { side: 'WAIT', confidence: 0, reason: 'trade active — waiting for exit' };
    }

    return this.checkBreakout(candles, zband);
  }

  private detectPivots(candles: Candle[]): void {
    const half = Math.floor(this.pivotPeriod / 2);
    if (candles.length < this.pivotPeriod) return;

    const pivotIdx = candles.length - half - 1;
    const window = candles.slice(pivotIdx - half, pivotIdx + half + 1);
    if (window.length < this.pivotPeriod) return;

    const mid = window[half]!;
    const isHigh = window.every(c => mid.high >= c.high);
    const isLow  = window.every(c => mid.low  <= c.low);

    // Time-based slope from the two most recent candles
    const prev = candles[candles.length - 2]!;
    const curr = candles[candles.length - 1]!;
    const timeDelta = curr.timestamp - prev.timestamp;
    const slope = timeDelta !== 0 ? (curr.close - prev.close) / timeDelta : 0;

    if (isHigh) this.upperTrend = { startTime: mid.timestamp, startPrice: mid.high, slope };
    if (isLow)  this.lowerTrend = { startTime: mid.timestamp, startPrice: mid.low,  slope };
  }

  private checkBreakout(candles: Candle[], zband: number): StrategySignal {
    const curr = candles[candles.length - 1]!;
    const prev = candles[candles.length - 2]!;

    if (this.upperTrend) {
      const prevLine = trendValue(this.upperTrend, prev.timestamp);
      const currLine = trendValue(this.upperTrend, curr.timestamp);
      if (prev.close < prevLine && curr.close > currLine) {
        this.tradeOn = true;
        this.isLong  = true;
        this.tp = curr.high + zband * 20;
        this.sl = curr.low  - zband * 20;
        return {
          side: 'LONG',
          confidence: 0.7,
          entry: curr.close.toString(),
          takeProfit: this.tp.toString(),
          stopLoss: this.sl.toString(),
          reason: `upper trendline breakout (zband=${zband.toFixed(4)})`,
          meta: { zband, tp: this.tp, sl: this.sl },
        };
      }
    }

    if (this.lowerTrend) {
      const prevLine = trendValue(this.lowerTrend, prev.timestamp);
      const currLine = trendValue(this.lowerTrend, curr.timestamp);
      if (prev.close > prevLine && curr.close < currLine) {
        this.tradeOn = true;
        this.isLong  = false;
        this.tp = curr.low  - zband * 20;
        this.sl = curr.high + zband * 20;
        return {
          side: 'SHORT',
          confidence: 0.7,
          entry: curr.close.toString(),
          takeProfit: this.tp.toString(),
          stopLoss: this.sl.toString(),
          reason: `lower trendline breakdown (zband=${zband.toFixed(4)})`,
          meta: { zband, tp: this.tp, sl: this.sl },
        };
      }
    }

    return {
      side: 'WAIT',
      confidence: 0,
      reason: 'no trendline breakout',
      noTradeCondition: 'waiting for trendline cross',
    };
  }

  /** Returns true when the trade has been closed (TP or SL hit). */
  private manageTrade(candle: Candle): boolean {
    if (this.isLong) {
      if (candle.high >= this.tp || candle.close <= this.sl) {
        this.tradeOn = false;
        return true;
      }
    } else {
      if (candle.low <= this.tp || candle.close >= this.sl) {
        this.tradeOn = false;
        return true;
      }
    }
    return false;
  }
}
