import type { StrategyTrigger } from '../types';

export function tfMs(tf: string): number {
  const m = /^(\d+)([mh])$/.exec(tf);
  if (!m) throw new Error(`unsupported tf: ${tf}`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 60 * 60_000 : n * 60_000;
}

export interface BarDriverOptions {
  runEvaluation: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void>;
}

interface Entry {
  id: string;
  pairs: Set<string>;
  timeframes: string[];
  lastBucket: Map<string, number>;
}

export class BarDriver {
  private entries = new Map<string, Entry>();

  constructor(private opts: BarDriverOptions) {}

  add(args: { id: string; pairs: string[]; timeframes: string[] }): void {
    this.entries.set(args.id, {
      id: args.id, pairs: new Set(args.pairs),
      timeframes: args.timeframes, lastBucket: new Map(),
    });
  }

  tradeAt(pair: string, ts: number): void {
    for (const e of this.entries.values()) {
      if (!e.pairs.has(pair)) continue;
      for (const tf of e.timeframes) {
        const bucket = Math.floor(ts / tfMs(tf));
        const key = `${pair}|${tf}`;
        const last = e.lastBucket.get(key);
        if (last === undefined) {
          e.lastBucket.set(key, bucket);
          continue;
        }
        if (bucket > last) {
          e.lastBucket.set(key, bucket);
          void this.opts.runEvaluation(e.id, pair, { kind: 'bar_close', tf });
        }
      }
    }
  }
}
