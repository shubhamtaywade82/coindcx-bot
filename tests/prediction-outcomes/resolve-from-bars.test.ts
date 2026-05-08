import { describe, it, expect } from 'vitest';
import { levelsGeometryValid, resolvePredictionOn15mBars } from '../../src/prediction-outcomes/resolve-from-bars';
import type { Candle } from '../../src/ai/state-builder';

const BAR = 15 * 60 * 1000;

function bar(ts: number, o: number, h: number, l: number, c: number): Candle {
  return { timestamp: ts, open: o, high: h, low: l, close: c, volume: 1 };
}

describe('resolvePredictionOn15mBars', () => {
  it('returns invalid_geometry when levels disagree with side', () => {
    const r = resolvePredictionOn15mBars({
      side: 'LONG',
      entry: 100,
      sl: 101,
      tp: 110,
      signalMs: 1_000,
      ttlMs: 3600_000,
      nowMs: 10_000_000,
      bars15m: [],
    });
    expect(r.outcome).toBe('invalid_geometry');
  });

  it('LONG: tp_first when high reaches tp before low hits sl across bars', () => {
    const t0 = 1_000_000;
    const candles: Candle[] = [
      bar(t0, 100, 101, 99.5, 100.5),
      bar(t0 + BAR, 100.5, 105, 100, 104),
    ];
    const r = resolvePredictionOn15mBars({
      side: 'LONG',
      entry: 100,
      sl: 98,
      tp: 104,
      signalMs: t0,
      ttlMs: 3600_000,
      nowMs: t0 + 3 * BAR,
      bars15m: candles,
    });
    expect(r.outcome).toBe('tp_first');
    expect(r.barsExamined).toBeGreaterThanOrEqual(1);
  });

  it('LONG: sl_first when both hit same bar (pessimistic)', () => {
    const t0 = 1_000_000;
    const candles: Candle[] = [bar(t0, 100, 105, 95, 101)];
    const r = resolvePredictionOn15mBars({
      side: 'LONG',
      entry: 100,
      sl: 96,
      tp: 104,
      signalMs: t0,
      ttlMs: 3600_000,
      nowMs: t0 + BAR,
      bars15m: candles,
    });
    expect(r.outcome).toBe('sl_first');
  });

  it('SHORT: tp_first when low reaches tp', () => {
    const t0 = 2_000_000;
    const candles: Candle[] = [bar(t0, 100, 100.5, 92, 93)];
    const r = resolvePredictionOn15mBars({
      side: 'SHORT',
      entry: 100,
      sl: 103,
      tp: 93,
      signalMs: t0,
      ttlMs: 3600_000,
      nowMs: t0 + BAR,
      bars15m: candles,
    });
    expect(r.outcome).toBe('tp_first');
  });

  it('returns pending when TTL not reached and no decisive bar', () => {
    const t0 = 5_000_000;
    const candles: Candle[] = [bar(t0, 100, 100.2, 99.9, 100.1)];
    const r = resolvePredictionOn15mBars({
      side: 'LONG',
      entry: 100,
      sl: 90,
      tp: 120,
      signalMs: t0,
      ttlMs: 3600_000,
      nowMs: t0 + BAR,
      bars15m: candles,
    });
    expect(r.outcome).toBe('pending');
  });

  it('returns ttl_neutral after deadline without tp/sl', () => {
    const t0 = 8_000_000;
    const candles: Candle[] = [bar(t0, 100, 100.2, 99.9, 100.1)];
    const r = resolvePredictionOn15mBars({
      side: 'LONG',
      entry: 100,
      sl: 90,
      tp: 120,
      signalMs: t0,
      ttlMs: 10_000,
      nowMs: t0 + 20_000,
      bars15m: candles,
    });
    expect(r.outcome).toBe('ttl_neutral');
  });
});

describe('levelsGeometryValid', () => {
  it('accepts canonical LONG and SHORT geometry', () => {
    expect(levelsGeometryValid('LONG', 100, 99, 101)).toBe(true);
    expect(levelsGeometryValid('SHORT', 100, 101, 99)).toBe(true);
  });
});
