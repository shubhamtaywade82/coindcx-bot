import type { Position } from '../../account/types';
import type { AppLogger } from '../../logging/logger';
import type { RuntimeWorker } from './types';

export interface BreakevenProtectionWorkerOptions {
  intervalMs: number;
  armPct: number;
  logger: AppLogger;
  clock?: () => number;
  getPositions: () => Position[];
  getMarkPrice: (pair: string) => number | undefined;
  onBreakevenArm: (input: { pair: string; positionId: string; markPrice: number; avgPrice: number; side: Position['side'] }) => Promise<void> | void;
}

function finitePositive(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function progressPct(position: Position, markPrice: number): number | undefined {
  const avgPrice = finitePositive(position.avgPrice);
  if (avgPrice === undefined) return undefined;
  if (position.side === 'long') return (markPrice - avgPrice) / avgPrice;
  if (position.side === 'short') return (avgPrice - markPrice) / avgPrice;
  return undefined;
}

export class BreakevenProtectionWorker implements RuntimeWorker {
  readonly id = 'breakeven-protection-worker';
  private timer: NodeJS.Timeout | null = null;
  private readonly armed = new Set<string>();
  private readonly clock: () => number;

  constructor(private readonly opts: BreakevenProtectionWorkerOptions) {
    this.clock = opts.clock ?? Date.now;
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
    const positions = this.opts.getPositions();
    for (const position of positions) {
      if (position.side === 'flat') continue;
      if (this.armed.has(position.id)) continue;
      const markPrice = this.opts.getMarkPrice(position.pair);
      if (markPrice === undefined) continue;
      const pct = progressPct(position, markPrice);
      if (pct === undefined || pct < this.opts.armPct) continue;
      const avgPrice = finitePositive(position.avgPrice);
      if (avgPrice === undefined) continue;
      this.armed.add(position.id);
      try {
        await this.opts.onBreakevenArm({
          pair: position.pair,
          positionId: position.id,
          markPrice,
          avgPrice,
          side: position.side,
        });
      } catch (error) {
        this.armed.delete(position.id);
        this.opts.logger.warn(
          {
            mod: 'worker.breakeven',
            pair: position.pair,
            positionId: position.id,
            ts: this.clock(),
            err: error instanceof Error ? error.message : String(error),
          },
          'breakeven worker callback failed',
        );
      }
    }
  }
}
