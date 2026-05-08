import type { Candle } from '../ai/state-builder';

export type ResolvedOutcome = 'tp_first' | 'sl_first' | 'ttl_neutral' | 'invalid_geometry';
export type LiveResolution = ResolvedOutcome | 'pending';

const BAR_MS_15M = 15 * 60 * 1000;

export function levelsGeometryValid(side: 'LONG' | 'SHORT', entry: number, sl: number, tp: number): boolean {
  if (![entry, sl, tp].every(n => Number.isFinite(n))) return false;
  if (side === 'LONG') return sl < entry && entry < tp;
  return tp < entry && entry < sl;
}

/**
 * Conservative intrabar rule: if both TP and SL print inside the same 15m bar, assume the stop path
 * resolved first (harsher calibration for adaptive learning).
 */
export function resolvePredictionOn15mBars(args: {
  side: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  signalMs: number;
  ttlMs: number;
  nowMs: number;
  /** Oldest first, timestamp = bar open ms */
  bars15m: Candle[];
}): { outcome: LiveResolution; barsExamined: number } {
  const { side, entry, sl, tp, signalMs, ttlMs, nowMs, bars15m } = args;
  if (!levelsGeometryValid(side, entry, sl, tp)) {
    return { outcome: 'invalid_geometry', barsExamined: 0 };
  }

  const deadlineMs = signalMs + ttlMs;
  const relevant = bars15m
    .filter(c => Number.isFinite(c.timestamp) && c.timestamp + BAR_MS_15M > signalMs && c.timestamp <= nowMs)
    .sort((a, b) => a.timestamp - b.timestamp);

  let barsExamined = 0;
  for (const c of relevant) {
    const barEnd = c.timestamp + BAR_MS_15M;
    if (barEnd > nowMs) break;
    barsExamined += 1;
    const { low, high } = c;
    if (side === 'LONG') {
      const hitSl = low <= sl;
      const hitTp = high >= tp;
      if (hitSl && hitTp) return { outcome: 'sl_first', barsExamined };
      if (hitSl) return { outcome: 'sl_first', barsExamined };
      if (hitTp) return { outcome: 'tp_first', barsExamined };
    } else {
      const hitSl = high >= sl;
      const hitTp = low <= tp;
      if (hitSl && hitTp) return { outcome: 'sl_first', barsExamined };
      if (hitSl) return { outcome: 'sl_first', barsExamined };
      if (hitTp) return { outcome: 'tp_first', barsExamined };
    }
  }

  if (nowMs >= deadlineMs) return { outcome: 'ttl_neutral', barsExamined };
  return { outcome: 'pending', barsExamined };
}
