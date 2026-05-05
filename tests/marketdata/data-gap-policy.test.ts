import { describe, expect, it } from 'vitest';
import {
  captureLiquidationPrice,
  estimateSyntheticFundingRate,
  resolveMarkPrice,
  resolveOpenInterest,
} from '../../src/marketdata/data-gap-policy';

describe('data gap policy', () => {
  it('uses mark price when available, otherwise falls back to last then avg', () => {
    expect(resolveMarkPrice({ markPrice: 101, lastPrice: 100, avgPrice: 99 })).toBe(101);
    expect(resolveMarkPrice({ markPrice: undefined, lastPrice: '100.5', avgPrice: 99 })).toBe(100.5);
    expect(resolveMarkPrice({ markPrice: undefined, lastPrice: undefined, avgPrice: '98.2' })).toBe(98.2);
  });

  it('estimates synthetic funding from basis when mark and spot are available', () => {
    const estimate = estimateSyntheticFundingRate({
      futuresMarkPrice: 102,
      spotLastPrice: 100,
      intervalHours: 8,
    });
    expect(estimate).toBeDefined();
    expect(estimate?.basisRatio).toBeCloseTo(0.02, 8);
    expect(estimate?.estimatedFundingRate).toBeCloseTo(0.02 / 3, 8);
  });

  it('returns undefined synthetic funding when required values are missing', () => {
    expect(estimateSyntheticFundingRate({ futuresMarkPrice: undefined, spotLastPrice: 100 })).toBeUndefined();
    expect(estimateSyntheticFundingRate({ futuresMarkPrice: 100, spotLastPrice: undefined })).toBeUndefined();
  });

  it('treats open interest as optional and resolves common keys', () => {
    expect(resolveOpenInterest({ open_interest: '1500.1' })).toBe(1500.1);
    expect(resolveOpenInterest({ oi: 2000 })).toBe(2000);
    expect(resolveOpenInterest({})).toBeUndefined();
    expect(resolveOpenInterest(undefined)).toBeUndefined();
  });

  it('captures liquidation opportunistically and preserves prior value when missing', () => {
    expect(captureLiquidationPrice({ observedLiquidationPrice: '90000', previousLiquidationPrice: '85000' })).toBe('90000');
    expect(captureLiquidationPrice({ observedLiquidationPrice: undefined, previousLiquidationPrice: '85000' })).toBe(
      '85000',
    );
  });
});
