import type { BacktestEvent, DataSource } from '../types';
import { tfMs } from '../../scheduler/bar-driver';

interface RawCandle { ts: number; o: number; h: number; l: number; c: number }

export interface CandleSourceOptions {
  pair: string;
  tf: string;
  fromMs: number;
  toMs: number;
  fetcher: (pair: string, tf: string, fromMs: number, toMs: number) => Promise<RawCandle[]>;
}

export class CandleSource implements DataSource {
  private received = 0;
  private expected = 0;

  constructor(private opts: CandleSourceOptions) {}

  async *iterate(): AsyncIterable<BacktestEvent> {
    const candles = await this.opts.fetcher(this.opts.pair, this.opts.tf, this.opts.fromMs, this.opts.toMs);
    const tfDur = tfMs(this.opts.tf);
    this.expected = Math.floor((this.opts.toMs - this.opts.fromMs) / tfDur);
    let cursor = this.opts.fromMs;
    for (const c of candles) {
      while (cursor + tfDur <= c.ts) {
        yield { ts: cursor, kind: 'gap', pair: this.opts.pair, reason: 'missing bar' };
        cursor += tfDur;
      }
      yield { ts: c.ts, kind: 'bar_close', pair: this.opts.pair, tf: this.opts.tf, price: c.c, high: c.h, low: c.l, raw: c };
      this.received++;
      cursor = c.ts + tfDur;
    }
  }

  coverage(): number {
    return this.expected === 0 ? 0 : this.received / this.expected;
  }
}
