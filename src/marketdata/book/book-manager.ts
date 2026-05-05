import { EventEmitter } from 'node:events';
import { OrderBook } from './orderbook';

export interface DepthFrame {
  asks: Array<[string, string]>;
  bids: Array<[string, string]>;
  ts: number;
  seq?: number;
  prevSeq?: number;
}

export class BookManager extends EventEmitter {
  private books = new Map<string, OrderBook>();
  private recentFrames = new Map<string, DepthFrame>();

  get(pair: string): OrderBook | undefined { return this.books.get(pair); }
  pairs(): string[] { return [...this.books.keys()]; }

  private getOrCreate(pair: string): OrderBook {
    let b = this.books.get(pair);
    if (!b) {
      b = new OrderBook(pair);
      b.on('gap', (e) => this.emit('gap', { pair, ...e }));
      this.books.set(pair, b);
    }
    return b;
  }

  onDepthSnapshot(pair: string, frame: DepthFrame): void {
    const b = this.getOrCreate(pair);
    b.applySnapshot(frame.asks, frame.bids, frame.ts, frame.seq);
    this.recentFrames.set(pair, frame);
    this.emit('snapshotReceived', pair, frame);
  }

  onDepthDelta(pair: string, frame: DepthFrame): void {
    const b = this.books.get(pair);
    if (!b || b.state() === 'init' || b.state() === 'resyncing') {
      // WS may deliver depth-update before the first depth-snapshot, or while we wait
      // for a fresh snapshot after resubscribe — never treat that as a book gap.
      return;
    }
    b.applyDelta(frame.asks, frame.bids, frame.ts, frame.seq, frame.prevSeq);
    this.recentFrames.set(pair, frame);
  }

  latestFrame(pair: string): DepthFrame | undefined {
    return this.recentFrames.get(pair);
  }
}
