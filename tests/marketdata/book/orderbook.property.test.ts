import { describe, it } from 'vitest';
import fc from 'fast-check';
import { OrderBook } from '../../../src/marketdata/book/orderbook';

describe('OrderBook (property)', () => {
  it('checksum is stable across two books built from same operations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('A', 'B'),
            fc.integer({ min: 100, max: 10000 }).map((n) => (n / 100).toFixed(4)),
            fc.integer({ min: 1, max: 1000 }).map((n) => (n / 100).toFixed(4)),
          ),
          { maxLength: 50 },
        ),
        (ops) => {
          const a = new OrderBook('X');
          const b = new OrderBook('X');
          a.applySnapshot([], [], 1);
          b.applySnapshot([], [], 1);
          let seq = 2;
          for (const [side, price, qty] of ops) {
            const asks: Array<[string, string]> = side === 'A' ? [[price, qty]] : [];
            const bids: Array<[string, string]> = side === 'B' ? [[price, qty]] : [];
            a.applyDelta(asks, bids, seq);
            b.applyDelta(asks, bids, seq);
            seq++;
          }
          return a.checksum() === b.checksum();
        },
      ),
      { numRuns: 50 },
    );
  });
});
