import type { Candle } from '../ai/state-builder';
import type { TradeFlow } from './trade-flow';

export interface AnchoredVwapContexts {
  session: number;
  daily: number;
  swing: number;
}

export interface TtmSqueezeSignal {
  squeezeOn: boolean;
  breakout: 'up' | 'down' | 'none';
  bbWidth: number;
  kcWidth: number;
}

export interface EmaStackSignal {
  ema9: number;
  ema21: number;
  ema50: number;
  alignment: 'bullish' | 'bearish' | 'mixed';
}

export interface RsiDivergenceSignal {
  rsi: number;
  divergence: 'bullish' | 'bearish' | 'none';
  pricePivotDelta: number;
  rsiPivotDelta: number;
}

export interface AtrPercentileRankSignal {
  atr: number;
  percentile: number;
}

export interface RollingOrderFlowImbalanceSignal {
  value: number;
  buyVolume: number;
  sellVolume: number;
  windowMs: number;
  source: 'trade-flow' | 'candle-fallback';
}

export interface IntradayIndicators {
  anchoredVwap: AnchoredVwapContexts;
  ttmSqueeze: TtmSqueezeSignal;
  emaStack: EmaStackSignal;
  rsiDivergence: RsiDivergenceSignal;
  atrPercentileRank: AtrPercentileRankSignal;
  rollingOrderFlowImbalance: RollingOrderFlowImbalanceSignal;
}

export interface ComputeIntradayIndicatorsInput {
  pair: string;
  candles1m: Candle[];
  candles15m: Candle[];
  tradeFlow?: TradeFlow;
  nowMs?: number;
}

const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const PERCENTILE_WINDOW = 200;
const ORDER_FLOW_WINDOW_MS = 15 * 60_000;

function toFinite(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function simpleMovingAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function exponentialMovingAverage(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return simpleMovingAverage(values);
  const alpha = 2 / (period + 1);
  let ema = simpleMovingAverage(values.slice(0, period));
  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] * alpha) + (ema * (1 - alpha));
  }
  return ema;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = simpleMovingAverage(values);
  const variance = values.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function currentDayStartMs(timestampMs: number): number {
  const now = new Date(timestampMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
}

function vwap(candles: Candle[], fallback: number): number {
  let weighted = 0;
  let volume = 0;
  for (const candle of candles) {
    if (candle.volume <= 0) continue;
    weighted += candle.close * candle.volume;
    volume += candle.volume;
  }
  if (volume <= 0) return fallback;
  return weighted / volume;
}

function anchoredVwap(input: ComputeIntradayIndicatorsInput, nowMs: number): AnchoredVwapContexts {
  const candles = input.candles1m;
  const latestClose = candles[candles.length - 1]?.close ?? 0;
  if (candles.length === 0) {
    return { session: latestClose, daily: latestClose, swing: latestClose };
  }
  const dayStart = currentDayStartMs(nowMs);
  const sessionCandles = candles.filter((candle) => candle.timestamp >= dayStart);
  const dailyCandles = candles.filter((candle) => candle.timestamp >= (nowMs - 24 * 60 * 60_000));
  const swingSample = candles.slice(-100);
  let swingAnchor = 0;
  for (let index = 1; index < swingSample.length; index += 1) {
    if (swingSample[index].low < swingSample[swingAnchor].low) swingAnchor = index;
  }
  const swingCandles = swingSample.slice(swingAnchor);
  return {
    session: vwap(sessionCandles, latestClose),
    daily: vwap(dailyCandles, latestClose),
    swing: vwap(swingCandles, latestClose),
  };
}

function trueRange(previousClose: number, candle: Candle): number {
  const range = candle.high - candle.low;
  const highGap = Math.abs(candle.high - previousClose);
  const lowGap = Math.abs(candle.low - previousClose);
  return Math.max(range, highGap, lowGap);
}

function ttmSqueeze(candles: Candle[]): TtmSqueezeSignal {
  const fallback: TtmSqueezeSignal = { squeezeOn: false, breakout: 'none', bbWidth: 0, kcWidth: 0 };
  if (candles.length < 21) return fallback;
  const closeSeries = candles.map((candle) => candle.close);
  const current20 = closeSeries.slice(-20);
  const prev20 = closeSeries.slice(-21, -1);
  const currentSma = simpleMovingAverage(current20);
  const prevSma = simpleMovingAverage(prev20);
  const currentStd = stdDev(current20);
  const prevStd = stdDev(prev20);
  const currentBbUpper = currentSma + (2 * currentStd);
  const currentBbLower = currentSma - (2 * currentStd);
  const prevBbUpper = prevSma + (2 * prevStd);
  const prevBbLower = prevSma - (2 * prevStd);
  const trSeries: number[] = [];
  for (let index = candles.length - 20; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1]?.close ?? candle.close;
    trSeries.push(trueRange(previousClose, candle));
  }
  const prevTrSeries: number[] = [];
  for (let index = candles.length - 21; index < candles.length - 1; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1]?.close ?? candle.close;
    prevTrSeries.push(trueRange(previousClose, candle));
  }
  const currentAtr = simpleMovingAverage(trSeries);
  const prevAtr = simpleMovingAverage(prevTrSeries);
  const currentKcBasis = exponentialMovingAverage(closeSeries.slice(-20), 20);
  const prevKcBasis = exponentialMovingAverage(closeSeries.slice(-21, -1), 20);
  const currentKcUpper = currentKcBasis + (1.5 * currentAtr);
  const currentKcLower = currentKcBasis - (1.5 * currentAtr);
  const prevKcUpper = prevKcBasis + (1.5 * prevAtr);
  const prevKcLower = prevKcBasis - (1.5 * prevAtr);
  const squeezeOn = currentBbUpper < currentKcUpper && currentBbLower > currentKcLower;
  const prevSqueezeOn = prevBbUpper < prevKcUpper && prevBbLower > prevKcLower;
  const close = closeSeries[closeSeries.length - 1];
  const breakout: TtmSqueezeSignal['breakout'] =
    prevSqueezeOn && !squeezeOn
      ? close > currentKcUpper
        ? 'up'
        : close < currentKcLower
          ? 'down'
          : 'none'
      : 'none';
  return {
    squeezeOn,
    breakout,
    bbWidth: Math.max(0, currentBbUpper - currentBbLower),
    kcWidth: Math.max(0, currentKcUpper - currentKcLower),
  };
}

function emaStack(candles: Candle[]): EmaStackSignal {
  const closes = candles.map((candle) => candle.close);
  const ema9 = exponentialMovingAverage(closes, 9);
  const ema21 = exponentialMovingAverage(closes, 21);
  const ema50 = exponentialMovingAverage(closes, 50);
  const lastPrice = closes[closes.length - 1] ?? 0;
  const alignment: EmaStackSignal['alignment'] =
    ema9 > ema21 && ema21 > ema50 && lastPrice >= ema9
      ? 'bullish'
      : ema9 < ema21 && ema21 < ema50 && lastPrice <= ema9
        ? 'bearish'
        : 'mixed';
  return { ema9, ema21, ema50, alignment };
}

function rsiSeries(closes: number[], period: number): Array<number | undefined> {
  if (closes.length < period + 1) return closes.map(() => undefined);
  const values: Array<number | undefined> = closes.map(() => undefined);
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gain += delta;
    else loss += Math.abs(delta);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  values[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const currentGain = delta > 0 ? delta : 0;
    const currentLoss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + currentGain) / period;
    avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    values[index] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return values;
}

function pivotIndices(values: number[], mode: 'high' | 'low'): number[] {
  const pivots: number[] = [];
  for (let index = 2; index < values.length - 2; index += 1) {
    const left1 = values[index - 1];
    const left2 = values[index - 2];
    const center = values[index];
    const right1 = values[index + 1];
    const right2 = values[index + 2];
    if (
      mode === 'low' &&
      center <= left1 &&
      center <= left2 &&
      center <= right1 &&
      center <= right2
    ) {
      pivots.push(index);
    }
    if (
      mode === 'high' &&
      center >= left1 &&
      center >= left2 &&
      center >= right1 &&
      center >= right2
    ) {
      pivots.push(index);
    }
  }
  return pivots;
}

function rsiDivergence(candles: Candle[]): RsiDivergenceSignal {
  const closes = candles.map((candle) => candle.close);
  const rsi = rsiSeries(closes, RSI_PERIOD);
  const latestRsi = toFinite(rsi[rsi.length - 1], 50);
  const lows = pivotIndices(closes, 'low');
  const highs = pivotIndices(closes, 'high');
  const latestTwoLows = lows.slice(-2);
  const latestTwoHighs = highs.slice(-2);

  if (latestTwoLows.length === 2) {
    const firstLowIndex = latestTwoLows[0];
    const secondLowIndex = latestTwoLows[1];
    const firstRsi = rsi[firstLowIndex];
    const secondRsi = rsi[secondLowIndex];
    if (
      firstRsi !== undefined &&
      secondRsi !== undefined &&
      closes[secondLowIndex] < closes[firstLowIndex] &&
      secondRsi > firstRsi
    ) {
      return {
        rsi: latestRsi,
        divergence: 'bullish',
        pricePivotDelta: closes[secondLowIndex] - closes[firstLowIndex],
        rsiPivotDelta: secondRsi - firstRsi,
      };
    }
  }

  if (latestTwoHighs.length === 2) {
    const firstHighIndex = latestTwoHighs[0];
    const secondHighIndex = latestTwoHighs[1];
    const firstRsi = rsi[firstHighIndex];
    const secondRsi = rsi[secondHighIndex];
    if (
      firstRsi !== undefined &&
      secondRsi !== undefined &&
      closes[secondHighIndex] > closes[firstHighIndex] &&
      secondRsi < firstRsi
    ) {
      return {
        rsi: latestRsi,
        divergence: 'bearish',
        pricePivotDelta: closes[secondHighIndex] - closes[firstHighIndex],
        rsiPivotDelta: secondRsi - firstRsi,
      };
    }
  }

  return {
    rsi: latestRsi,
    divergence: 'none',
    pricePivotDelta: 0,
    rsiPivotDelta: 0,
  };
}

function atrPercentileRank(candles: Candle[]): AtrPercentileRankSignal {
  if (candles.length < ATR_PERIOD + 1) return { atr: 0, percentile: 0 };
  const trSeries: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    trSeries.push(trueRange(candles[index - 1].close, candles[index]));
  }
  const atrSeries: number[] = [];
  for (let index = ATR_PERIOD - 1; index < trSeries.length; index += 1) {
    atrSeries.push(simpleMovingAverage(trSeries.slice(index - (ATR_PERIOD - 1), index + 1)));
  }
  const rolling = atrSeries.slice(-PERCENTILE_WINDOW);
  const currentAtr = rolling[rolling.length - 1] ?? 0;
  const lessOrEqual = rolling.filter((value) => value <= currentAtr).length;
  const percentile = rolling.length > 0 ? lessOrEqual / rolling.length : 0;
  return { atr: currentAtr, percentile };
}

function rollingOrderFlowImbalance(
  pair: string,
  candles1m: Candle[],
  tradeFlow: TradeFlow | undefined,
  nowMs: number,
): RollingOrderFlowImbalanceSignal {
  const tradeWindow = tradeFlow?.windowMetrics(pair, ORDER_FLOW_WINDOW_MS, nowMs);
  if (tradeWindow && tradeWindow.totalVol > 0) {
    return {
      value: tradeWindow.imbalance,
      buyVolume: tradeWindow.buyVol,
      sellVolume: tradeWindow.sellVol,
      windowMs: ORDER_FLOW_WINDOW_MS,
      source: 'trade-flow',
    };
  }
  const sample = candles1m.slice(-15);
  let buyVolume = 0;
  let sellVolume = 0;
  for (const candle of sample) {
    if (candle.close >= candle.open) buyVolume += candle.volume;
    else sellVolume += candle.volume;
  }
  const total = buyVolume + sellVolume;
  const value = total > 0 ? (buyVolume - sellVolume) / total : 0;
  return {
    value,
    buyVolume,
    sellVolume,
    windowMs: ORDER_FLOW_WINDOW_MS,
    source: 'candle-fallback',
  };
}

export function computeIntradayIndicators(input: ComputeIntradayIndicatorsInput): IntradayIndicators {
  const nowMs = input.nowMs ?? Date.now();
  return {
    anchoredVwap: anchoredVwap(input, nowMs),
    ttmSqueeze: ttmSqueeze(input.candles1m),
    emaStack: emaStack(input.candles1m),
    rsiDivergence: rsiDivergence(input.candles1m),
    atrPercentileRank: atrPercentileRank(input.candles15m),
    rollingOrderFlowImbalance: rollingOrderFlowImbalance(
      input.pair,
      input.candles1m,
      input.tradeFlow,
      nowMs,
    ),
  };
}
