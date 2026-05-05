import type { AppLogger } from '../../logging/logger';
import type { RuntimeWorker } from './types';

export interface FundingWindowWorkerOptions {
  intervalMs: number;
  leadMs: number;
  windowsUtc: string[];
  logger: AppLogger;
  clock?: () => number;
  onFundingWindow: (input: { windowIso: string; leadMs: number }) => Promise<void> | void;
}

function parseUtcWindowToMinutes(window: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(window.trim());
  if (!match) {
    throw new Error(`invalid funding window: ${window}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`invalid funding window: ${window}`);
  }
  return (hours * 60) + minutes;
}

function toWindowTimestamp(baseMs: number, windowMinuteOfDay: number, dayOffset: number): number {
  const baseDate = new Date(baseMs);
  const utcStartOfDay = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate() + dayOffset,
    0,
    0,
    0,
    0,
  );
  return utcStartOfDay + (windowMinuteOfDay * 60_000);
}

function nearestUpcomingWindow(nowMs: number, windowsMinuteOfDay: number[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const dayOffset of [0, 1]) {
    for (const windowMinuteOfDay of windowsMinuteOfDay) {
      const candidate = toWindowTimestamp(nowMs, windowMinuteOfDay, dayOffset);
      if (candidate >= nowMs && candidate < nearest) {
        nearest = candidate;
      }
    }
  }
  if (!Number.isFinite(nearest)) {
    throw new Error('no upcoming funding window found');
  }
  return nearest;
}

export class FundingWindowWorker implements RuntimeWorker {
  readonly id = 'funding-window-worker';
  private timer: NodeJS.Timeout | null = null;
  private readonly windowsMinuteOfDay: number[];
  private readonly clock: () => number;
  private lastTriggeredWindowMs?: number;

  constructor(private readonly opts: FundingWindowWorkerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.windowsMinuteOfDay = opts.windowsUtc.map(parseUtcWindowToMinutes);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const nowMs = this.clock();
    const windowMs = nearestUpcomingWindow(nowMs, this.windowsMinuteOfDay);
    const triggerMs = windowMs - this.opts.leadMs;
    if (nowMs < triggerMs) return;
    if (this.lastTriggeredWindowMs === windowMs) return;
    this.lastTriggeredWindowMs = windowMs;
    try {
      await this.opts.onFundingWindow({
        windowIso: new Date(windowMs).toISOString(),
        leadMs: this.opts.leadMs,
      });
    } catch (error) {
      this.lastTriggeredWindowMs = undefined;
      this.opts.logger.warn(
        {
          mod: 'worker.funding',
          windowIso: new Date(windowMs).toISOString(),
          err: error instanceof Error ? error.message : String(error),
        },
        'funding worker callback failed',
      );
    }
  }
}
