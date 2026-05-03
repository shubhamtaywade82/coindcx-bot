import { describe, it, expect } from 'vitest';
import { TradeFlow } from '../../src/marketdata/trade-flow';

describe('TradeFlow', () => {
  it('aggregates buy/sell volumes per window using m flag', () => {
    const tf = new TradeFlow();
    const t0 = 1_000_000;
    tf.ingestRaw({ T: t0, p: '100', q: '1', m: 0, s: 'B-X_USDT' });   // buyer aggressive
    tf.ingestRaw({ T: t0 + 1000, p: '100', q: '2', m: 1, s: 'B-X_USDT' }); // seller aggressive
    tf.ingestRaw({ T: t0 + 2000, p: '100', q: '3', m: false, s: 'B-X_USDT' }); // buyer aggressive
    const m = tf.metrics('B-X_USDT', t0 + 2000);
    expect(m).not.toBeNull();
    expect(m!.windows['60s'].buyVol).toBe(4);
    expect(m!.windows['60s'].sellVol).toBe(2);
    expect(m!.windows['60s'].delta).toBe(2);
    expect(m!.windows['60s'].imbalance).toBeCloseTo(2 / 6);
    expect(m!.cvd).toBe(2);
  });

  it('drops trades outside the largest window', () => {
    const tf = new TradeFlow();
    const t0 = 1_000_000;
    tf.ingestRaw({ T: t0, p: '100', q: '1', m: 0, s: 'B-X_USDT' });
    tf.ingestRaw({ T: t0 + 400_000, p: '100', q: '5', m: 0, s: 'B-X_USDT' });
    const m = tf.metrics('B-X_USDT', t0 + 400_000);
    expect(m!.windows['300s'].trades).toBe(1);
    expect(m!.windows['300s'].buyVol).toBe(5);
  });

  it('ignores malformed trades', () => {
    const tf = new TradeFlow();
    tf.ingestRaw({ T: NaN, p: '100', q: '1', m: 0, s: 'B-X_USDT' });
    tf.ingestRaw({ T: 1, p: '100', q: '0', m: 0, s: 'B-X_USDT' });
    tf.ingestRaw({ T: 1, p: '100', q: '1', m: 0 });
    expect(tf.metrics('B-X_USDT')).toBeNull();
  });

  it('returns zero imbalance when window has no trades', () => {
    const tf = new TradeFlow();
    tf.ingestRaw({ T: 1_000_000, p: '100', q: '1', m: 0, s: 'B-X_USDT' });
    const m = tf.metrics('B-X_USDT', 1_000_000 + 70_000);
    expect(m!.windows['60s'].trades).toBe(0);
    expect(m!.windows['60s'].imbalance).toBe(0);
    expect(m!.windows['300s'].trades).toBe(1);
  });
});
