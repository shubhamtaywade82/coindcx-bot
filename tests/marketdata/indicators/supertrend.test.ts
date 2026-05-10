import { describe, expect, it } from 'vitest';
import {
  computeSupertrend,
  computeSupertrendSeries,
  computeWilderAtr,
  type SupertrendCandle,
} from '../../../src/marketdata/indicators/supertrend';

describe('computeWilderAtr', () => {
  it('matches hand-calculated Wilder smoothing for length=2', () => {
    const candles: SupertrendCandle[] = [
      { high: 10, low: 8, close: 9 },
      { high: 11, low: 9, close: 10 },
      { high: 12, low: 10, close: 11 },
    ];
    const atr = computeWilderAtr(candles, 2);
    const tr0 = 10 - 8;
    const tr1 = Math.max(11 - 9, Math.abs(11 - 9), Math.abs(9 - 9));
    const tr2 = Math.max(12 - 10, Math.abs(12 - 10), Math.abs(10 - 10));
    expect(tr0).toBe(2);
    expect(tr1).toBe(2);
    expect(tr2).toBe(2);
    const atr1 = (tr0 + tr1) / 2;
    expect(atr[1]).toBeCloseTo(atr1, 8);
    const atr2 = (atr1 * 1 + tr2) / 2;
    expect(atr[2]).toBeCloseTo(atr2, 8);
  });
});

describe('computeSupertrend', () => {
  it('returns null when not enough candles', () => {
    const short: SupertrendCandle[] = Array.from({ length: 10 }, () => ({
      high: 100,
      low: 99,
      close: 99.5,
    }));
    expect(computeSupertrend(short, 14, 2)).toBeNull();
  });

  it('keeps uptrend on steadily rising closes (no flip)', () => {
    const candles: SupertrendCandle[] = [];
    let base = 100;
    for (let i = 0; i < 40; i++) {
      base += 0.5;
      candles.push({
        high: base + 0.2,
        low: base - 0.1,
        close: base,
      });
    }
    const st = computeSupertrend(candles, 14, 2);
    expect(st).not.toBeNull();
    expect(st!.direction).toBe('up');
    expect(st!.flipped).toBe(false);
    expect(Number.isFinite(st!.value)).toBe(true);
    expect(Number.isFinite(st!.atr)).toBe(true);
  });

  it('flips to downtrend after a sharp drop through the lower band', () => {
    const candles: SupertrendCandle[] = [];
    let base = 200;
    for (let i = 0; i < 35; i++) {
      candles.push({
        high: base + 0.5,
        low: base - 0.2,
        close: base,
      });
      base += 0.3;
    }
    const crash = base - 25;
    candles.push({
      high: crash + 2,
      low: crash - 5,
      close: crash - 4,
    });
    const series = computeSupertrendSeries(candles, 14, 2);
    expect(series).not.toBeNull();
    const last = series!.direction.length - 1;
    expect(series!.direction[last]).toBe('down');
    const st = computeSupertrend(candles, 14, 2);
    expect(st!.flipped).toBe(true);
    expect(st!.direction).toBe('down');
  });
});
