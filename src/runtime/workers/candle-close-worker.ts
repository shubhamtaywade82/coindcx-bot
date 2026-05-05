import type { AppLogger } from '../../logging/logger';
import type { RuntimeWorker } from './types';

export interface CandleCloseWorkerOptions {
  pairs: string[];
  timeframes: string[];
  tickMs: number;
  logger: AppLogger;
  clock?: () => number;
  onCandleClose: (pair: string, timeframe: string, bucket: number) => Promise<void> | void;
}

function timeframeToMs(timeframe: string): number {
  const match = /^(\d+)([mh])$/.exec(timeframe);
  if (!match) throw new Error(`unsupported timeframe: ${timeframe}`);
  const amount = Number(match[1]);
  return match[2] === 'h' ? amount * 60 * 60_000 : amount * 60_000;
}

export class CandleCloseWorker implements RuntimeWorker {
  readonly id = 'candle-close-worker';
  private timer: NodeJS.Timeout | null = null;
  private readonly timeframeMs: Map<string, number>;
  private readonly lastBuckets = new Map<string, number>();
  private readonly clock: () => number;

  constructor(private readonly opts: CandleCloseWorkerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.timeframeMs = new Map(
      opts.timeframes.map((timeframe) => [timeframe, timeframeToMs(timeframe)]),
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.tickMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = this.clock();
    for (const pair of this.opts.pairs) {
      for (const [timeframe, tfMs] of this.timeframeMs) {
        const bucket = Math.floor(now / tfMs);
        const key = `${pair}|${timeframe}`;
        const last = this.lastBuckets.get(key);
        if (last === undefined) {
          this.lastBuckets.set(key, bucket);
          continue;
        }
        if (bucket <= last) continue;
        this.lastBuckets.set(key, bucket);
        try {
          await this.opts.onCandleClose(pair, timeframe, bucket);
        } catch (error) {
          this.opts.logger.warn(
            {
              mod: 'worker.candle_close',
              pair,
              timeframe,
              bucket,
              err: error instanceof Error ? error.message : String(error),
            },
            'candle-close worker callback failed',
          );
        }
      }
    }
  }
}
