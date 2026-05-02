import type { EventEmitter } from 'events';
import type { StrategyTrigger, TickChannel } from '../types';

export interface TickDriverOptions {
  ws: EventEmitter;
  runEvaluation: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void>;
  extractPair: (raw: unknown) => string | undefined;
}

interface Entry {
  id: string;
  pairs: Set<string>;
  channels: TickChannel[];
  pending: Set<string>;
  drops: Map<string, number>;
  handlers: Array<{ ch: TickChannel; fn: (raw: unknown) => void }>;
}

export class TickDriver {
  private entries = new Map<string, Entry>();
  private started = false;

  constructor(private opts: TickDriverOptions) {}

  add(args: { id: string; pairs: string[]; channels: TickChannel[] }): void {
    this.entries.set(args.id, {
      id: args.id, pairs: new Set(args.pairs), channels: args.channels,
      pending: new Set(), drops: new Map(), handlers: [],
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const e of this.entries.values()) {
      for (const ch of e.channels) {
        const fn = (raw: unknown) => this.dispatch(e, ch, raw);
        this.opts.ws.on(ch, fn);
        e.handlers.push({ ch, fn });
      }
    }
  }

  stop(): void {
    for (const e of this.entries.values()) {
      for (const h of e.handlers) this.opts.ws.off(h.ch, h.fn);
      e.handlers = [];
    }
    this.started = false;
  }

  dropped(id: string, pair: string): number {
    return this.entries.get(id)?.drops.get(pair) ?? 0;
  }

  private dispatch(e: Entry, ch: TickChannel, raw: unknown): void {
    const pair = this.opts.extractPair(raw);
    if (!pair || !e.pairs.has(pair)) return;
    if (e.pending.has(pair)) {
      e.drops.set(pair, (e.drops.get(pair) ?? 0) + 1);
      return;
    }
    e.pending.add(pair);
    void this.opts.runEvaluation(e.id, pair, { kind: 'tick', channel: ch, raw }).finally(() => {
      e.pending.delete(pair);
    });
  }
}
