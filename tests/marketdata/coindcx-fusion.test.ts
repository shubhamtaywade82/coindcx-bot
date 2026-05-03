import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { CoinDcxFusion } from '../../src/marketdata/coindcx-fusion';
import type { Candle } from '../../src/ai/state-builder';

class FakeMtfStore extends EventEmitter {
  constructor(private readonly snapshots: Map<string, { pair: string; timeframes: Record<string, Candle[]>; lastUpdatedAt: number }>) {
    super();
  }

  getSnapshot(pair: string) {
    return this.snapshots.get(pair) ?? null;
  }
}

class FakeBook {
  constructor(private readonly asks: Array<{ price: string; qty: string }>, private readonly bids: Array<{ price: string; qty: string }>) {}
  topN() {
    return { asks: this.asks, bids: this.bids };
  }
}

class FakeBooks {
  constructor(private readonly books: Map<string, FakeBook>) {}
  get(pair: string) {
    return this.books.get(pair);
  }
}

describe('CoinDcxFusion microstructure integration', () => {
  it('includes layer-1 microstructure metrics in fusion snapshots', () => {
    const ws = new EventEmitter();
    const candles: Candle[] = [
      { timestamp: 1, open: 1, high: 2, low: 1, close: 2, volume: 10 },
      { timestamp: 2, open: 2, high: 3, low: 2, close: 3, volume: 11 },
      { timestamp: 3, open: 3, high: 4, low: 3, close: 4, volume: 12 },
      { timestamp: 4, open: 4, high: 5, low: 4, close: 5, volume: 13 },
      { timestamp: 5, open: 5, high: 6, low: 5, close: 6, volume: 14 },
      { timestamp: 6, open: 6, high: 7, low: 6, close: 7, volume: 15 },
    ];
    const mtf = new FakeMtfStore(
      new Map([
        [
          'B-X_USDT',
          {
            pair: 'B-X_USDT',
            timeframes: { '1m': candles, '15m': candles, '1h': candles },
            lastUpdatedAt: Date.now(),
          },
        ],
      ]),
    ) as any;
    const books = new FakeBooks(
      new Map([
        [
          'B-X_USDT',
          new FakeBook(
            [
              { price: '100.5', qty: '2' },
              { price: '101', qty: '1' },
            ],
            [
              { price: '100', qty: '4' },
              { price: '99.5', qty: '3' },
            ],
          ),
        ],
      ]),
    ) as any;
    const now = 2_500_000;
    const tradeFlow = {
      metrics: vi.fn().mockReturnValue({
        pair: 'B-X_USDT',
        lastTradeTs: now - 1000,
        windows: {
          '60s': { windowMs: 60_000, trades: 3, buyVol: 3, sellVol: 1, totalVol: 4, delta: 2, imbalance: 0.5 },
          '300s': { windowMs: 300_000, trades: 4, buyVol: 4, sellVol: 2, totalVol: 6, delta: 2, imbalance: 0.3333 },
        },
        cvd: 12,
      }),
      windowMetrics: vi.fn()
        .mockImplementation((_pair: string, ms: number) => {
          if (ms === 15_000) {
            return { windowMs: 15_000, trades: 3, buyVol: 3, sellVol: 1, totalVol: 4, delta: 2, imbalance: 0.5 };
          }
          return { windowMs: 60_000, trades: 4, buyVol: 4, sellVol: 2, totalVol: 6, delta: 2, imbalance: 0.3333 };
        }),
      ticks: vi.fn().mockReturnValue([
        { ts: now - 190, price: 100, qty: 1.2, buyAggressive: true },
        { ts: now - 120, price: 100.1, qty: 1.1, buyAggressive: true },
        { ts: now - 40, price: 100.2, qty: 1.0, buyAggressive: true },
      ]),
      ingestRaw: vi.fn(),
    } as any;
    const logger = { child: () => logger, info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() } as any;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(now));
      const fusion = new CoinDcxFusion(logger, ws, mtf, books, tradeFlow);

      ws.emit('currentPrices@futures#update', {
        prices: {
          'B-X_USDT': { ls: '100', mp: '100.1', v: '1000', pc: '1.2', b: '99.9', a: '100.2' },
        },
      });

      const snapshot = fusion.getLatest('B-X_USDT');
      expect(snapshot).not.toBeNull();
      expect(snapshot?.microstructure.topNImbalance.imbalance).toBe('bid-heavy');
      expect(snapshot?.microstructure.cvd.cvd).toBe(12);
      expect(snapshot?.microstructure.sweep.detected).toBe(true);
      expect(snapshot?.microstructure.aggressorRatio.ratio).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
