export interface StaleEvent { channel: string; pair: string; gapMs: number; thresholdMs: number; }

export interface StaleWatcherOptions {
  floors: Record<string, number>;
  reservoirSize: number;
  onStale: (e: StaleEvent) => void;
  now?: () => number;
}

interface ChannelState {
  lastSeen: number;
  inter: number[];
  alarmed: boolean;
}

export class StaleWatcher {
  private channels = new Map<string, ChannelState>();
  private nowFn: () => number;

  constructor(private readonly opts: StaleWatcherOptions) {
    this.nowFn = opts.now ?? Date.now;
  }

  private key(channel: string, pair: string): string { return `${channel}::${pair}`; }

  touch(channel: string, pair: string): void {
    const k = this.key(channel, pair);
    const t = this.nowFn();
    let cs = this.channels.get(k);
    if (!cs) {
      cs = { lastSeen: t, inter: [], alarmed: false };
      this.channels.set(k, cs);
      return;
    }
    const dt = t - cs.lastSeen;
    if (cs.inter.length < this.opts.reservoirSize) cs.inter.push(dt);
    else cs.inter[Math.floor(Math.random() * cs.inter.length)] = dt;
    cs.lastSeen = t;
    cs.alarmed = false;
  }

  private p99(samples: number[]): number {
    if (samples.length === 0) return 0;
    const s = [...samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]!;
  }

  threshold(channel: string, samples: number[]): number {
    const floor = this.opts.floors[channel] ?? 10_000;
    return Math.max(floor, 3 * this.p99(samples));
  }

  tick(): void {
    const t = this.nowFn();
    for (const [k, cs] of this.channels) {
      const [channel, pair] = k.split('::') as [string, string];
      const th = this.threshold(channel, cs.inter);
      const gap = t - cs.lastSeen;
      if (gap > th && !cs.alarmed) {
        cs.alarmed = true;
        this.opts.onStale({ channel, pair, gapMs: gap, thresholdMs: th });
      }
    }
  }

  snapshot(channel: string, pair: string): { stale: boolean; gapMs: number; thresholdMs: number } {
    const cs = this.channels.get(this.key(channel, pair));
    if (!cs) return { stale: false, gapMs: 0, thresholdMs: 0 };
    const t = this.nowFn();
    const th = this.threshold(channel, cs.inter);
    return { stale: t - cs.lastSeen > th, gapMs: t - cs.lastSeen, thresholdMs: th };
  }
}
