import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Channel, RawFrame } from '../types';

export interface TailBufferOptions {
  capacity: number;
  dir: string;
}

export class TailBuffer {
  private rings = new Map<string, RawFrame[]>();

  constructor(private readonly opts: TailBufferOptions) {
    mkdirSync(opts.dir, { recursive: true });
  }

  push(channel: Channel | string, frame: { ts: number; raw: unknown }): void {
    let ring = this.rings.get(channel);
    if (!ring) {
      ring = [];
      this.rings.set(channel, ring);
    }
    ring.push({ ts: frame.ts, channel: channel as Channel, raw: frame.raw });
    if (ring.length > this.opts.capacity) ring.shift();
  }

  snapshot(channel: Channel | string): RawFrame[] {
    return [...(this.rings.get(channel) ?? [])];
  }

  async dump(channel?: Channel | string): Promise<string[]> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const channels = channel ? [channel] : Array.from(this.rings.keys());
    const written: string[] = [];
    for (const ch of channels) {
      const safe = String(ch).replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = join(this.opts.dir, `tail-${safe}-${ts}.jsonl`);
      const ring = this.rings.get(ch) ?? [];
      writeFileSync(file, ring.map((f) => JSON.stringify(f)).join('\n') + '\n');
      written.push(file);
    }
    return written;
  }
}
