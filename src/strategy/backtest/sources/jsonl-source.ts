import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { BacktestEvent, DataSource } from '../types';

export interface JsonlSourceOptions {
  path: string;
  pair: string;
  fromMs: number;
  toMs: number;
}

export class JsonlSource implements DataSource {
  private yielded = 0;

  constructor(private opts: JsonlSourceOptions) {}

  async *iterate(): AsyncIterable<BacktestEvent> {
    const rl = createInterface({ input: createReadStream(this.opts.path), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      const ts = Number(parsed.ts);
      if (!Number.isFinite(ts) || ts < this.opts.fromMs || ts > this.opts.toMs) continue;
      const pair = parsed.raw?.pair ?? parsed.raw?.s;
      if (pair !== this.opts.pair) continue;
      const price = Number(parsed.raw?.price ?? parsed.raw?.p);
      this.yielded++;
      yield { ts, kind: 'tick', pair, price: Number.isFinite(price) ? price : undefined, raw: parsed.raw };
    }
  }

  coverage(): number {
    return this.yielded === 0 ? 0 : 1;
  }
}
