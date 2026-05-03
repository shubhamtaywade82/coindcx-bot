import type { Pool } from 'pg';
import type { AuditEvent } from './types';

export interface AuditOptions {
  pool: Pool;
  bufferMax: number;
  drainMs?: number;
  onDrop?: (count: number) => void;
  onError?: (err: Error, queueDepth: number) => void;
}

const INSERT_SQL =
  'INSERT INTO audit_events (kind, source, seq, payload) VALUES ($1,$2,$3,$4)';

export class Audit {
  private queue: AuditEvent[] = [];
  private timer?: NodeJS.Timeout;
  private running = false;
  private draining = false;

  constructor(private readonly opts: AuditOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (): void => {
      if (!this.running) return;
      void this.drainOnce().finally(() => {
        if (this.running) this.timer = setTimeout(tick, this.opts.drainMs ?? 100);
      });
    };
    this.timer = setTimeout(tick, this.opts.drainMs ?? 100);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.drainOnce();
  }

  recordEvent(ev: AuditEvent): void {
    if (this.queue.length >= this.opts.bufferMax) {
      const drop = this.queue.length - this.opts.bufferMax + 1;
      this.queue.splice(0, drop);
      this.opts.onDrop?.(drop);
    }
    this.queue.push(ev);
  }

  size(): number {
    return this.queue.length;
  }

  private async drainOnce(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const ev = this.queue[0]!;
        try {
          await this.opts.pool.query(INSERT_SQL, [
            ev.kind,
            ev.source,
            ev.seq ?? null,
            JSON.stringify(ev.payload),
          ]);
          this.queue.shift();
        } catch (err) {
          this.opts.onError?.(err as Error, this.queue.length);
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
