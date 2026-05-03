import { describe, it, expect } from 'vitest';
import { toCoinDcxFuturesInstrument, cleanPair } from '../../src/utils/format';

describe('toCoinDcxFuturesInstrument', () => {
  it('passes through canonical CoinDCX futures ids', () => {
    expect(toCoinDcxFuturesInstrument('B-SOL_USDT')).toBe('B-SOL_USDT');
    expect(toCoinDcxFuturesInstrument('B-BTC_USDT')).toBe('B-BTC_USDT');
  });

  it('maps compact BASEUSDT to B-BASE_USDT', () => {
    expect(toCoinDcxFuturesInstrument('SOLUSDT')).toBe('B-SOL_USDT');
    expect(toCoinDcxFuturesInstrument('solusdt')).toBe('B-SOL_USDT');
  });

  it('maps BASE_USDT without B- prefix', () => {
    expect(toCoinDcxFuturesInstrument('SOL_USDT')).toBe('B-SOL_USDT');
  });

  it('supports leveled 1000* names', () => {
    expect(toCoinDcxFuturesInstrument('1000PEPEUSDT')).toBe('B-1000PEPE_USDT');
  });
});

describe('cleanPair with normalized instruments', () => {
  it('strips B- and underscore for display', () => {
    expect(cleanPair(toCoinDcxFuturesInstrument('SOLUSDT'))).toBe('SOLUSDT');
  });
});
