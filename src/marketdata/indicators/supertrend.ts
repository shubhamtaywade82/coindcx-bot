/**
 * Supertrend (ATR bands + trend flip rules).
 * ATR uses Wilder (RMA) smoothing.
 */

export interface SupertrendCandle {
  high: number;
  low: number;
  close: number;
}

export interface SupertrendResult {
  direction: 'up' | 'down';
  flipped: boolean;
  value: number;
  atr: number;
}

function trueRange(h: number, l: number, prevClose: number | undefined): number {
  if (prevClose === undefined) return h - l;
  return Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
}

/** Wilder ATR; first value at index `length - 1`. */
export function computeWilderAtr(candles: SupertrendCandle[], length: number): number[] {
  const n = candles.length;
  const tr = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? candles[i - 1]!.close : undefined;
    tr[i] = trueRange(candles[i]!.high, candles[i]!.low, prev);
  }
  const atr = new Array<number>(n).fill(Number.NaN);
  if (n < length) return atr;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += tr[i]!;
  atr[length - 1] = sum / length;
  for (let i = length; i < n; i++) {
    atr[i] = (atr[i - 1]! * (length - 1) + tr[i]!) / length;
  }
  return atr;
}

/**
 * Full-series Supertrend walk. Returns null if not enough bars.
 */
export function computeSupertrendSeries(
  candles: SupertrendCandle[],
  length: number,
  multiplier: number,
): { direction: ('up' | 'down')[]; finalUpper: number[]; finalLower: number[]; atr: number[] } | null {
  const n = candles.length;
  if (n < length) return null;
  const atr = computeWilderAtr(candles, length);
  const hl2 = candles.map((c) => (c.high + c.low) / 2);
  const upperBand = hl2.map((m, i) => m + multiplier * atr[i]!);
  const lowerBand = hl2.map((m, i) => m - multiplier * atr[i]!);

  const finalUpper = new Array<number>(n).fill(Number.NaN);
  const finalLower = new Array<number>(n).fill(Number.NaN);
  const direction: ('up' | 'down')[] = new Array(n).fill('up');

  const start = length - 1;
  finalUpper[start] = upperBand[start]!;
  finalLower[start] = lowerBand[start]!;
  let trend: 'up' | 'down' =
    candles[start]!.close <= finalLower[start]! ? 'down' : 'up';
  direction[start] = trend;

  for (let i = start + 1; i < n; i++) {
    const prevClose = candles[i - 1]!.close;
    const fuPrev = finalUpper[i - 1]!;
    const flPrev = finalLower[i - 1]!;
    finalUpper[i] =
      upperBand[i]! < fuPrev || prevClose > fuPrev ? upperBand[i]! : fuPrev;
    finalLower[i] =
      lowerBand[i]! > flPrev || prevClose < flPrev ? lowerBand[i]! : flPrev;

    if (trend === 'up' && candles[i]!.close <= finalLower[i]!) {
      trend = 'down';
    } else if (trend === 'down' && candles[i]!.close >= finalUpper[i]!) {
      trend = 'up';
    }
    direction[i] = trend;
  }

  return { direction, finalUpper, finalLower, atr };
}

/**
 * Latest closed-bar Supertrend snapshot + flip vs previous bar.
 */
export function computeSupertrend(
  candles: SupertrendCandle[],
  length: number,
  multiplier: number,
): SupertrendResult | null {
  const series = computeSupertrendSeries(candles, length, multiplier);
  if (!series) return null;
  const last = candles.length - 1;
  const start = length - 1;
  if (last < start) return null;
  const { direction, finalUpper, finalLower, atr } = series;
  const dir = direction[last]!;
  const prevDir = last > start ? direction[last - 1]! : dir;
  const flipped = last > start && dir !== prevDir;
  const value = dir === 'up' ? finalLower[last]! : finalUpper[last]!;
  return {
    direction: dir,
    flipped,
    value,
    atr: atr[last]!,
  };
}
