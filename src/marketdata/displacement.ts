import type { Candle } from '../ai/state-builder';

export type DisplacementStrength = 'weak' | 'strong';

export interface DisplacementResult {
  present: boolean;
  strength: DisplacementStrength;
}

/**
 * Candle-body displacement vs recent average (same heuristic as legacy MarketStateBuilder.analyzeSMC).
 */
export function displacementFromCandles(candles: Candle[], lookback = 10): DisplacementResult {
  if (candles.length < 2) {
    return { present: false, strength: 'weak' };
  }
  const last = candles[candles.length - 1]!;
  const lastBody = Math.abs(last.close - last.open);
  const slice = candles.slice(-lookback);
  if (slice.length === 0) {
    return { present: false, strength: 'weak' };
  }
  const avgBody = slice.reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / slice.length;
  if (avgBody <= 0) {
    return { present: false, strength: 'weak' };
  }
  const present = lastBody > avgBody * 1.5;
  const strength: DisplacementStrength = lastBody > avgBody * 2.5 ? 'strong' : 'weak';
  return { present, strength };
}
