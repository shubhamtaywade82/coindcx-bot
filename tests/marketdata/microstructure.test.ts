import { describe, expect, it } from 'vitest';
import {
  computeMicrostructureMetrics,
  computeTopNBookImbalance,
} from '../../src/marketdata/microstructure';
import { TradeFlow } from '../../src/marketdata/trade-flow';

function sampleTop() {
  return {
    bids: [
      { price: '100', qty: '5' },
      { price: '99.5', qty: '4' },
    ],
    asks: [
      { price: '100.5', qty: '2' },
      { price: '101', qty: '1' },
    ],
  };
}

describe('computeTopNBookImbalance', () => {
  it('computes top-N book imbalance ratio and label', () => {
    const out = computeTopNBookImbalance({ top: sampleTop() });
    expect(out.bidVolume).toBe(9);
    expect(out.askVolume).toBe(3);
    expect(out.imbalanceRatio).toBeCloseTo(0.5);
    expect(out.imbalance).toBe('bid-heavy');
  });
});

describe('computeMicrostructureMetrics', () => {
  it('computes CVD, aggressor ratio, and tape-speed acceleration', () => {
    const flow = new TradeFlow();
    const now = 1_000_000;
    flow.ingestRaw({ T: now - 10_000, p: '100', q: '1', m: false, s: 'B-X_USDT' });
    flow.ingestRaw({ T: now - 5_000, p: '100', q: '2', m: false, s: 'B-X_USDT' });
    flow.ingestRaw({ T: now - 4_000, p: '100', q: '1', m: true, s: 'B-X_USDT' });

    const out = computeMicrostructureMetrics({
      pair: 'B-X_USDT',
      top: sampleTop(),
      tradeFlow: flow,
      nowMs: now,
    });

    expect(out.cvd.cvd).toBeCloseTo(2);
    expect(out.aggressorRatio.buyAggressiveVolume).toBe(3);
    expect(out.aggressorRatio.sellAggressiveVolume).toBe(1);
    expect(out.aggressorRatio.ratio).toBe(3);
    expect(out.tapeSpeedAcceleration.shortTrades).toBe(3);
    expect(out.tapeSpeedAcceleration.acceleration).toBeGreaterThanOrEqual(0);
  });

  it('detects sweep burst within <=200ms cluster', () => {
    const flow = new TradeFlow();
    const now = 2_000_000;
    flow.ingestRaw({ T: now - 190, p: '100', q: '1.2', m: false, s: 'B-X_USDT' });
    flow.ingestRaw({ T: now - 120, p: '100.1', q: '1.1', m: false, s: 'B-X_USDT' });
    flow.ingestRaw({ T: now - 40, p: '100.2', q: '1.0', m: false, s: 'B-X_USDT' });

    const out = computeMicrostructureMetrics({
      pair: 'B-X_USDT',
      top: sampleTop(),
      tradeFlow: flow,
      nowMs: now,
    });

    expect(out.sweep.detected).toBe(true);
    expect(out.sweep.side).toBe('buy');
    expect(out.sweep.burstTrades).toBeGreaterThanOrEqual(3);
  });

  it('flags iceberg-like absorption without sweep', () => {
    const flow = new TradeFlow();
    const now = 3_000_000;
    flow.ingestRaw({ T: now - 10_000, p: '100', q: '1', m: true, s: 'B-X_USDT' });
    flow.ingestRaw({ T: now - 8_000, p: '99.9', q: '1', m: true, s: 'B-X_USDT' });
    flow.ingestRaw({ T: now - 6_000, p: '99.8', q: '1', m: true, s: 'B-X_USDT' });

    const out = computeMicrostructureMetrics({
      pair: 'B-X_USDT',
      top: {
        bids: [{ price: '99.8', qty: '8' }],
        asks: [{ price: '100.2', qty: '1' }],
      },
      tradeFlow: flow,
      nowMs: now,
    });

    expect(out.sweep.detected).toBe(false);
    expect(out.icebergSpoof.icebergLikely).toBe(true);
  });
});
