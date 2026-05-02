import type { StrategyTrigger } from '../types';

export interface IntervalDriverOptions {
  runEvaluation: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void>;
}

interface Entry {
  id: string;
  pairs: string[];
  intervalMs: number;
  pending: Set<string>;
  timer: NodeJS.Timeout | null;
}

export class IntervalDriver {
  private entries = new Map<string, Entry>();

  constructor(private opts: IntervalDriverOptions) {}

  add(args: { id: string; pairs: string[]; intervalMs: number }): void {
    this.entries.set(args.id, { id: args.id, pairs: [...args.pairs], intervalMs: args.intervalMs, pending: new Set(), timer: null });
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (e?.timer) clearInterval(e.timer);
    this.entries.delete(id);
  }

  start(): void {
    for (const e of this.entries.values()) {
      if (e.timer) continue;
      e.timer = setInterval(() => { void this.fire(e); }, e.intervalMs);
    }
  }

  stop(): void {
    for (const e of this.entries.values()) {
      if (e.timer) clearInterval(e.timer);
      e.timer = null;
    }
  }

  private async fire(e: Entry): Promise<void> {
    for (const pair of e.pairs) {
      if (e.pending.has(pair)) continue;
      e.pending.add(pair);
      void this.opts.runEvaluation(e.id, pair, { kind: 'interval' }).finally(() => {
        e.pending.delete(pair);
      });
    }
  }
}
