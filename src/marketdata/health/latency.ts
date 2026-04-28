export type LatencyKind = 'wsRtt' | 'tickAge';

export interface LatencySnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LatencyOptions { reservoirSize: number; }

export class LatencyTracker {
  private reservoirs = new Map<string, number[]>();

  constructor(private readonly opts: LatencyOptions) {}

  private key(channel: string, kind: LatencyKind): string {
    return `${channel}::${kind}`;
  }

  record(channel: string, kind: LatencyKind, ms: number): void {
    const k = this.key(channel, kind);
    let arr = this.reservoirs.get(k);
    if (!arr) { arr = []; this.reservoirs.set(k, arr); }
    if (arr.length < this.opts.reservoirSize) {
      arr.push(ms);
    } else {
      const idx = Math.floor(Math.random() * (arr.length + 1));
      if (idx < arr.length) arr[idx] = ms;
    }
  }

  snapshot(channel: string, kind: LatencyKind): LatencySnapshot {
    const arr = this.reservoirs.get(this.key(channel, kind));
    if (!arr || arr.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    return {
      count: sorted.length,
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: sorted[sorted.length - 1]!,
    };
  }
}
