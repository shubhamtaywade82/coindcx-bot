import { describe, it, expect } from 'vitest';
import { OrderBook } from '../../../src/marketdata/book/orderbook';

describe('OrderBook', () => {
  it('starts in init state', () => {
    expect(new OrderBook('B-SOL_USDT').state()).toBe('init');
  });

  it('snapshot transitions to live and best bid/ask correct', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot([['86.5700', '5'], ['86.5800', '10']], [['86.5600', '7'], ['86.5500', '3']], 1);
    expect(b.state()).toBe('live');
    expect(b.bestAsk()?.price).toBe('86.5700');
    expect(b.bestBid()?.price).toBe('86.5600');
  });

  it('delta with qty=0 deletes level', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot([['86.5700', '5']], [['86.5600', '7']], 1);
    b.applyDelta([['86.5700', '0']], [], 2);
    expect(b.bestAsk()).toBeUndefined();
  });

  it('delta deleting unknown price emits gap', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot([['86.5700', '5']], [['86.5600', '7']], 1);
    let gap = false;
    b.on('gap', () => { gap = true; });
    b.applyDelta([['90.0000', '0']], [], 2);
    expect(gap).toBe(true);
  });

  it('checksum changes when book changes and is stable for same content', () => {
    const a = new OrderBook('B-SOL_USDT');
    const b = new OrderBook('B-SOL_USDT');
    a.applySnapshot([['1', '1']], [['0.5', '1']], 1);
    b.applySnapshot([['1', '1']], [['0.5', '1']], 1);
    expect(a.checksum()).toBe(b.checksum());
    a.applyDelta([['1', '2']], [], 2);
    expect(a.checksum()).not.toBe(b.checksum());
  });

  it('topN returns asks ascending and bids descending', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot(
      [['100', '1'], ['90', '1'], ['110', '1']],
      [['80', '1'], ['85', '1'], ['70', '1']],
      1,
    );
    const top = b.topN(2);
    expect(top.asks.map((l) => l.price)).toEqual(['90', '100']);
    expect(top.bids.map((l) => l.price)).toEqual(['85', '80']);
  });
});
