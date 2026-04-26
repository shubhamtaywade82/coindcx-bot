import type { Fill } from '../types';

export interface FillsLedgerOptions {
  ringSize: number;
}

export class FillsLedger {
  private ring: Fill[] = [];
  private ids = new Set<string>();
  private maxCursor = '';

  constructor(private opts: FillsLedgerOptions) {}

  append(fill: Fill): boolean {
    if (this.ids.has(fill.id)) return false;
    this.ring.push(fill);
    this.ids.add(fill.id);
    if (fill.executedAt > this.maxCursor) this.maxCursor = fill.executedAt;
    while (this.ring.length > this.opts.ringSize) {
      const evicted = this.ring.shift()!;
      this.ids.delete(evicted.id);
    }
    return true;
  }

  recent(n: number): Fill[] {
    return this.ring
      .slice()
      .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
      .slice(-n);
  }

  knownIds(): Set<string> {
    return this.ids;
  }

  cursor(): string {
    return this.maxCursor;
  }

  setCursor(ts: string): void {
    if (ts > this.maxCursor) this.maxCursor = ts;
  }
}
