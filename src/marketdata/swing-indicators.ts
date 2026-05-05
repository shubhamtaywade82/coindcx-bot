import type { Candle } from '../ai/state-builder';

export interface MarketStructureShiftSignal {
  trend: 'uptrend' | 'downtrend' | 'range';
  mss: 'bullish' | 'bearish' | 'none';
  lastSwingHigh: number;
  lastSwingLow: number;
}

export interface PivotLevels {
  pivot: number;
  r1: number;
  s1: number;
}

export interface DailyWeeklyPivotsSignal {
  daily: PivotLevels | null;
  weekly: PivotLevels | null;
}

export interface EmaBiasFilterSignal {
  ema50: number;
  ema200: number;
  bias: 'bullish' | 'bearish' | 'neutral';
}

export interface FundingRateExtremesSignal {
  rate?: number;
  zScore?: number;
  extreme: 'positive' | 'negative' | 'none';
}

export interface OiPriceTruthTableSignal {
  oiDeltaPct?: number;
  priceDeltaPct?: number;
  classification:
    | 'long-buildup'
    | 'short-buildup'
    | 'long-unwinding'
    | 'short-covering'
    | 'neutral'
    | 'unavailable';
}

export interface SpotFuturesBasisSignal {
  basis?: number;
  zScore?: number;
  state: 'contango' | 'backwardation' | 'flat' | 'unavailable';
}

export interface BtcDominanceCorrelationFilterSignal {
  isAlt: boolean;
  btcCorrelation?: number;
  btcDominance?: number;
  filter: 'allow' | 'caution';
  reason: string;
}

export interface SwingIndicators {
  marketStructureShift: MarketStructureShiftSignal;
  dailyWeeklyPivots: DailyWeeklyPivotsSignal;
  emaBiasFilter: EmaBiasFilterSignal;
  fundingRateExtremes: FundingRateExtremesSignal;
  oiPriceTruthTable: OiPriceTruthTableSignal;
  spotFuturesBasis: SpotFuturesBasisSignal;
  btcDominanceCorrelationFilter: BtcDominanceCorrelationFilterSignal;
}

export interface SwingHistoryPoint {
  ts: number;
  price: number;
  openInterest?: number;
  basis?: number;
  syntheticFundingRate?: number;
}

export interface ComputeSwingIndicatorsInput {
  pair: string;
  candles1h: Candle[];
  ltp: {
    price: number;
    basis?: number;
    openInterest?: number;
    syntheticFundingRate?: number;
  };
  historyByPair: ReadonlyMap<string, SwingHistoryPoint[]>;
  nowMs?: number;
  btcPair?: string;
}

const DEFAULT_BTC_PAIR = 'B-BTC_USDT';
const DELTA_NOISE_FLOOR = 0.001;
const BASIS_FLAT_BAND = 0.001;
const BASIS_EXTREME = 0.005;
const FUNDING_EXTREME = 0.001;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return average(values);
  const alpha = 2 / (period + 1);
  let out = average(values.slice(0, period));
  for (let index = period; index < values.length; index += 1) {
    out = (values[index] * alpha) + (out * (1 - alpha));
  }
  return out;
}

function localHighIndices(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const center = candles[index].high;
    if (
      center >= candles[index - 1].high &&
      center >= candles[index - 2].high &&
      center >= candles[index + 1].high &&
      center >= candles[index + 2].high
    ) {
      out.push(index);
    }
  }
  return out;
}

function localLowIndices(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const center = candles[index].low;
    if (
      center <= candles[index - 1].low &&
      center <= candles[index - 2].low &&
      center <= candles[index + 1].low &&
      center <= candles[index + 2].low
    ) {
      out.push(index);
    }
  }
  return out;
}

function marketStructureShift(candles1h: Candle[]): MarketStructureShiftSignal {
  if (candles1h.length < 10) {
    const close = candles1h[candles1h.length - 1]?.close ?? 0;
    return { trend: 'range', mss: 'none', lastSwingHigh: close, lastSwingLow: close };
  }
  const highs = localHighIndices(candles1h);
  const lows = localLowIndices(candles1h);
  const recentHighs = highs.slice(-2);
  const recentLows = lows.slice(-2);
  const lastSwingHigh = recentHighs.length > 0
    ? candles1h[recentHighs[recentHighs.length - 1]].high
    : candles1h[candles1h.length - 1].high;
  const lastSwingLow = recentLows.length > 0
    ? candles1h[recentLows[recentLows.length - 1]].low
    : candles1h[candles1h.length - 1].low;
  const trend =
    recentHighs.length === 2 &&
    recentLows.length === 2 &&
    candles1h[recentHighs[1]].high > candles1h[recentHighs[0]].high &&
    candles1h[recentLows[1]].low > candles1h[recentLows[0]].low
      ? 'uptrend'
      : recentHighs.length === 2 &&
          recentLows.length === 2 &&
          candles1h[recentHighs[1]].high < candles1h[recentHighs[0]].high &&
          candles1h[recentLows[1]].low < candles1h[recentLows[0]].low
        ? 'downtrend'
        : 'range';
  const close = candles1h[candles1h.length - 1].close;
  const mss =
    trend !== 'uptrend' && close > lastSwingHigh
      ? 'bullish'
      : trend !== 'downtrend' && close < lastSwingLow
        ? 'bearish'
        : 'none';
  return { trend, mss, lastSwingHigh, lastSwingLow };
}

function pivotFromCandles(candles: Candle[]): PivotLevels | null {
  if (candles.length === 0) return null;
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const close = candles[candles.length - 1].close;
  const pivot = (high + low + close) / 3;
  return {
    pivot,
    r1: (2 * pivot) - low,
    s1: (2 * pivot) - high,
  };
}

function dailyWeeklyPivots(candles1h: Candle[], nowMs: number): DailyWeeklyPivotsSignal {
  const dayMs = 24 * 60 * 60_000;
  const previousDayStart = nowMs - dayMs;
  const previousWeekStart = nowMs - (7 * dayMs);
  const dailyCandles = candles1h.filter((candle) => candle.timestamp >= previousDayStart && candle.timestamp < nowMs);
  const weeklyCandles = candles1h.filter((candle) => candle.timestamp >= previousWeekStart && candle.timestamp < nowMs);
  return {
    daily: pivotFromCandles(dailyCandles),
    weekly: pivotFromCandles(weeklyCandles),
  };
}

function emaBias(candles1h: Candle[]): EmaBiasFilterSignal {
  const closes = candles1h.map((candle) => candle.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const last = closes[closes.length - 1] ?? 0;
  const bias =
    ema50 > ema200 && last >= ema50
      ? 'bullish'
      : ema50 < ema200 && last <= ema50
        ? 'bearish'
        : 'neutral';
  return { ema50, ema200, bias };
}

function computeZScore(current: number | undefined, samples: number[]): number | undefined {
  if (current === undefined || samples.length < 2) return undefined;
  const mean = average(samples);
  const sigma = stdDev(samples);
  if (sigma <= 0) return 0;
  return (current - mean) / sigma;
}

function fundingRateExtremes(
  ltpRate: number | undefined,
  history: SwingHistoryPoint[],
): FundingRateExtremesSignal {
  const samples = history
    .map((point) => point.syntheticFundingRate)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .slice(-200);
  const zScore = computeZScore(ltpRate, samples);
  const extreme =
    ltpRate === undefined
      ? 'none'
      : ltpRate >= FUNDING_EXTREME || (zScore !== undefined && zScore >= 2)
        ? 'positive'
        : ltpRate <= -FUNDING_EXTREME || (zScore !== undefined && zScore <= -2)
          ? 'negative'
          : 'none';
  return {
    ...(ltpRate !== undefined ? { rate: ltpRate } : {}),
    ...(zScore !== undefined ? { zScore } : {}),
    extreme,
  };
}

function oiPriceTruthTable(history: SwingHistoryPoint[]): OiPriceTruthTableSignal {
  if (history.length < 2) return { classification: 'unavailable' };
  const recent = history[history.length - 1];
  const prior = history[history.length - 2];
  if (recent.openInterest === undefined || prior.openInterest === undefined || prior.openInterest === 0) {
    return { classification: 'unavailable' };
  }
  if (!Number.isFinite(recent.price) || !Number.isFinite(prior.price) || prior.price === 0) {
    return { classification: 'unavailable' };
  }
  const oiDeltaPct = (recent.openInterest - prior.openInterest) / Math.abs(prior.openInterest);
  const priceDeltaPct = (recent.price - prior.price) / Math.abs(prior.price);
  const oiFlat = Math.abs(oiDeltaPct) < DELTA_NOISE_FLOOR;
  const priceFlat = Math.abs(priceDeltaPct) < DELTA_NOISE_FLOOR;
  const classification =
    oiFlat || priceFlat
      ? 'neutral'
      : priceDeltaPct > 0 && oiDeltaPct > 0
        ? 'long-buildup'
        : priceDeltaPct < 0 && oiDeltaPct > 0
          ? 'short-buildup'
          : priceDeltaPct < 0 && oiDeltaPct < 0
            ? 'long-unwinding'
            : 'short-covering';
  return { oiDeltaPct, priceDeltaPct, classification };
}

function spotFuturesBasisSignal(
  ltpBasis: number | undefined,
  history: SwingHistoryPoint[],
): SpotFuturesBasisSignal {
  if (ltpBasis === undefined) return { state: 'unavailable' };
  const samples = history
    .map((point) => point.basis)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .slice(-200);
  const zScore = computeZScore(ltpBasis, samples);
  const state: SpotFuturesBasisSignal['state'] =
    ltpBasis > BASIS_FLAT_BAND
      ? 'contango'
      : ltpBasis < -BASIS_FLAT_BAND
        ? 'backwardation'
        : 'flat';
  const extreme =
    Math.abs(ltpBasis) >= BASIS_EXTREME || (zScore !== undefined && Math.abs(zScore) >= 2);
  const resolvedState: SpotFuturesBasisSignal['state'] =
    extreme && state === 'flat' ? 'contango' : state;
  return {
    basis: ltpBasis,
    ...(zScore !== undefined ? { zScore } : {}),
    state: resolvedState,
  };
}

function percentChangesFromHistory(history: SwingHistoryPoint[]): number[] {
  const sorted = [...history].sort((left, right) => left.ts - right.ts);
  const out: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].price;
    const current = sorted[index].price;
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) continue;
    out.push((current - previous) / Math.abs(previous));
  }
  return out;
}

function pearsonAligned(
  pairHistory: SwingHistoryPoint[],
  btcHistory: SwingHistoryPoint[],
): number | undefined {
  const btcByTs = new Map<number, number>();
  for (const point of btcHistory) {
    btcByTs.set(point.ts, point.price);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const orderedPair = [...pairHistory].sort((left, right) => left.ts - right.ts);
  for (let index = 1; index < orderedPair.length; index += 1) {
    const previous = orderedPair[index - 1];
    const current = orderedPair[index];
    const btcPrev = previous ? btcByTs.get(previous.ts) : undefined;
    const btcCurrent = btcByTs.get(current.ts);
    if (
      btcPrev === undefined ||
      btcCurrent === undefined ||
      previous.price === 0 ||
      btcPrev === 0
    ) {
      continue;
    }
    const pairReturn = (current.price - previous.price) / Math.abs(previous.price);
    const btcReturn = (btcCurrent - btcPrev) / Math.abs(btcPrev);
    if (!Number.isFinite(pairReturn) || !Number.isFinite(btcReturn)) continue;
    xs.push(pairReturn);
    ys.push(btcReturn);
  }
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return undefined;
  const alignedXs = xs.slice(-n);
  const alignedYs = ys.slice(-n);
  const meanX = average(alignedXs);
  const meanY = average(alignedYs);
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = alignedXs[index] - meanX;
    const dy = alignedYs[index] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  if (denom <= 0) return undefined;
  return cov / denom;
}

function pearson(a: number[], b: number[]): number | undefined {
  const n = Math.min(a.length, b.length);
  if (n < 3) return undefined;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const meanX = average(xs);
  const meanY = average(ys);
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  if (denom <= 0) return undefined;
  return cov / denom;
}

function latestAbsReturn(history: SwingHistoryPoint[]): number | undefined {
  if (history.length < 2) return undefined;
  const previous = history[history.length - 2].price;
  const current = history[history.length - 1].price;
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return undefined;
  return Math.abs((current - previous) / Math.abs(previous));
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function btcDominanceCorrelationFilter(
  pair: string,
  btcPair: string,
  historyByPair: ReadonlyMap<string, SwingHistoryPoint[]>,
): BtcDominanceCorrelationFilterSignal {
  const isAlt = pair !== btcPair;
  if (!isAlt) {
    return { isAlt: false, filter: 'allow', reason: 'BTC pair bypasses alt correlation filter' };
  }
  const pairHistory = historyByPair.get(pair) ?? [];
  const btcHistory = historyByPair.get(btcPair) ?? [];
  if (pairHistory.length < 5 || btcHistory.length < 5) {
    return {
      isAlt: true,
      filter: 'allow',
      reason: 'Insufficient history for BTC correlation/dominance filter',
    };
  }
  const pairReturns = percentChangesFromHistory(pairHistory);
  const btcReturns = percentChangesFromHistory(btcHistory);
  const btcCorrelation = pearsonAligned(pairHistory, btcHistory) ?? pearson(pairReturns, btcReturns);
  const btcReturnAbs = latestAbsReturn(btcHistory);
  const altReturnAbs = median(
    [...historyByPair.entries()]
      .filter(([otherPair]) => otherPair !== btcPair)
      .map(([_otherPair, history]) => latestAbsReturn(history))
      .filter((value): value is number => value !== undefined),
  );
  const btcDominance =
    btcReturnAbs !== undefined && altReturnAbs !== undefined && altReturnAbs > 0
      ? btcReturnAbs / altReturnAbs
      : undefined;
  const caution = (btcCorrelation ?? 0) >= 0.7 && (btcDominance ?? 0) >= 1.25;
  return {
    isAlt: true,
    ...(btcCorrelation !== undefined ? { btcCorrelation } : {}),
    ...(btcDominance !== undefined ? { btcDominance } : {}),
    filter: caution ? 'caution' : 'allow',
    reason: caution
      ? 'Alt strongly tracks BTC while BTC dominates market movement'
      : 'BTC correlation/dominance does not exceed caution thresholds',
  };
}

export function computeSwingIndicators(input: ComputeSwingIndicatorsInput): SwingIndicators {
  const nowMs = input.nowMs ?? Date.now();
  const btcPair = input.btcPair ?? DEFAULT_BTC_PAIR;
  const history = input.historyByPair.get(input.pair) ?? [];
  return {
    marketStructureShift: marketStructureShift(input.candles1h),
    dailyWeeklyPivots: dailyWeeklyPivots(input.candles1h, nowMs),
    emaBiasFilter: emaBias(input.candles1h),
    fundingRateExtremes: fundingRateExtremes(input.ltp.syntheticFundingRate, history),
    oiPriceTruthTable: oiPriceTruthTable(history),
    spotFuturesBasis: spotFuturesBasisSignal(input.ltp.basis, history),
    btcDominanceCorrelationFilter: btcDominanceCorrelationFilter(input.pair, btcPair, input.historyByPair),
  };
}
