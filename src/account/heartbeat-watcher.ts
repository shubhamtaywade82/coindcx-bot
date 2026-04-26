import type { Entity } from './types';

export interface HeartbeatFloors {
  position: number;
  balance: number;
  order: number;
  fill: number;
}

export interface HeartbeatOptions {
  floors: HeartbeatFloors;
  clock?: () => number;
  onStale: (channel: Entity) => void;
}

export class HeartbeatWatcher {
  private last: Record<Entity, number>;
  private staleNotified: Record<Entity, boolean>;
  private clock: () => number;

  constructor(private opts: HeartbeatOptions) {
    this.clock = opts.clock ?? Date.now;
    const now = this.clock();
    this.last = { position: now, balance: now, order: now, fill: now };
    this.staleNotified = { position: true, balance: true, order: true, fill: true };
  }

  touch(channel: Entity): void {
    this.last[channel] = this.clock();
    this.staleNotified[channel] = false;
  }

  tick(): void {
    const now = this.clock();
    const channels: Entity[] = ['position', 'balance', 'order', 'fill'];
    for (const ch of channels) {
      const age = now - this.last[ch];
      if (age >= this.opts.floors[ch] && !this.staleNotified[ch]) {
        this.staleNotified[ch] = true;
        this.opts.onStale(ch);
      }
    }
  }

  lastSeen(channel: Entity): number {
    return this.last[channel];
  }
}
