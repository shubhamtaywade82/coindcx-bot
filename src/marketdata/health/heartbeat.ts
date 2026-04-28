import type { EventEmitter } from 'node:events';

export interface HeartbeatOptions {
  ws: EventEmitter & { reconnect: () => void };
  intervalMs: number;
  timeoutMs: number;
  onLatency?: (rttMs: number) => void;
  onTimeout?: () => void;
}

export class Heartbeat {
  private lastPing?: number;
  private timer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;

  constructor(private readonly opts: HeartbeatOptions) {}

  start(): void {
    this.opts.ws.on('pong', (t: number) => {
      if (this.lastPing !== undefined) {
        this.opts.onLatency?.(t - this.lastPing);
      }
    });
    this.timer = setInterval(() => this.markPing(Date.now()), this.opts.intervalMs);
  }

  markPing(now: number): void {
    this.lastPing = now;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.opts.onTimeout?.();
      this.opts.ws.reconnect();
    }, this.opts.timeoutMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.watchdog) clearTimeout(this.watchdog);
  }
}
