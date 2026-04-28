import { describe, it, expect } from 'vitest';
import { BookManager } from '../../../src/marketdata/book/book-manager';

describe('BookManager', () => {
  it('creates a book per pair on first snapshot', () => {
    const m = new BookManager();
    m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [['0.5','1']], ts: 1 });
    expect(m.get('B-SOL_USDT')!.bestAsk()?.price).toBe('1');
  });

  it('routes deltas to correct book', () => {
    const m = new BookManager();
    m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [], ts: 1 });
    m.onDepthSnapshot('B-ETH_USDT', { asks: [['2','1']], bids: [], ts: 1 });
    m.onDepthDelta('B-SOL_USDT', { asks: [['1','5']], bids: [], ts: 2 });
    expect(m.get('B-SOL_USDT')!.bestAsk()?.qty).toBe('5');
    expect(m.get('B-ETH_USDT')!.bestAsk()?.qty).toBe('1');
  });

  it('emits gap event with pair', () => {
    const m = new BookManager();
    m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [], ts: 1 });
    let captured: any;
    m.on('gap', (e) => { captured = e; });
    m.onDepthDelta('B-SOL_USDT', { asks: [['9','0']], bids: [], ts: 2 });
    expect(captured.pair).toBe('B-SOL_USDT');
    expect(captured.reason).toBe('delete_unknown_ask');
  });
});
