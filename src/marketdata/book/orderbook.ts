import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { BookState, BookTopN, PriceLevel } from '../types';

type Levels = Map<string, string>;

export class OrderBook extends EventEmitter {
  private asks: Levels = new Map();
  private bids: Levels = new Map();
  private _state: BookState = 'init';
  private lastSeq = 0;
  private lastTs = 0;

  constructor(public readonly pair: string) { super(); }

  state(): BookState { return this._state; }
  setState(s: BookState): void { this._state = s; }

  applySnapshot(asks: Array<[string, string]>, bids: Array<[string, string]>, ts: number, seq?: number): void {
    this.asks.clear();
    this.bids.clear();
    for (const [p, q] of asks) if (parseFloat(q) > 0) this.asks.set(p, q);
    for (const [p, q] of bids) if (parseFloat(q) > 0) this.bids.set(p, q);
    this.lastTs = ts;
    if (seq !== undefined) this.lastSeq = seq;
    this._state = 'live';
    this.emit('snapshot');
  }

  applyDelta(asks: Array<[string, string]>, bids: Array<[string, string]>, ts: number, seq?: number, prevSeq?: number): void {
    if (seq !== undefined && prevSeq !== undefined && prevSeq !== this.lastSeq) {
      this.emit('gap', { reason: 'seq_mismatch', expected: this.lastSeq, prevSeq });
      return;
    }
    for (const [p, q] of asks) {
      if (parseFloat(q) === 0) {
        if (!this.asks.has(p)) {
          this.emit('gap', { reason: 'delete_unknown_ask', price: p });
          return;
        }
        this.asks.delete(p);
      } else {
        this.asks.set(p, q);
      }
    }
    for (const [p, q] of bids) {
      if (parseFloat(q) === 0) {
        if (!this.bids.has(p)) {
          this.emit('gap', { reason: 'delete_unknown_bid', price: p });
          return;
        }
        this.bids.delete(p);
      } else {
        this.bids.set(p, q);
      }
    }
    this.lastTs = ts;
    if (seq !== undefined) this.lastSeq = seq;
    this.emit('applied');
  }

  topN(n: number): BookTopN {
    const asks = [...this.asks.entries()]
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .slice(0, n)
      .map(([price, qty]) => ({ price, qty }));
    const bids = [...this.bids.entries()]
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .slice(0, n)
      .map(([price, qty]) => ({ price, qty }));
    return { asks, bids };
  }

  bestAsk(): PriceLevel | undefined { return this.topN(1).asks[0]; }
  bestBid(): PriceLevel | undefined { return this.topN(1).bids[0]; }

  spread(): number | undefined {
    const a = this.bestAsk(); const b = this.bestBid();
    return a && b ? parseFloat(a.price) - parseFloat(b.price) : undefined;
  }

  midPrice(): number | undefined {
    const a = this.bestAsk(); const b = this.bestBid();
    return a && b ? (parseFloat(a.price) + parseFloat(b.price)) / 2 : undefined;
  }

  checksum(): string {
    const top = this.topN(25);
    const lines = [
      ...top.asks.map((l) => `A:${l.price}:${l.qty}`),
      ...top.bids.map((l) => `B:${l.price}:${l.qty}`),
    ];
    return createHash('sha1').update(lines.join('\n')).digest('hex');
  }

  lastSequence(): number { return this.lastSeq; }
  lastTimestamp(): number { return this.lastTs; }
}
