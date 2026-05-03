import type { Position } from '../../account/types';
import type { Config } from '../../config/schema';
import type { AppLogger } from '../../logging/logger';
import { CandleCloseWorker } from './candle-close-worker';
import { BreakevenProtectionWorker } from './breakeven-protection-worker';
import { FundingWindowWorker } from './funding-window-worker';
import type { RuntimeWorker } from './types';

export interface RuntimeWorkerDependencies {
  config: Config;
  logger: AppLogger;
  pairs: string[];
  getPositions: () => Position[];
  getMarkPrice: (pair: string) => number | undefined;
  onCandleClose: (input: { pair: string; timeframe: string; bucket: number }) => Promise<void> | void;
  onBreakevenArm: (input: { pair: string; positionId: string; markPrice: number; avgPrice: number; side: Position['side'] }) => Promise<void> | void;
  onFundingWindow: (input: { windowIso: string; leadMs: number }) => Promise<void> | void;
}

export class RuntimeWorkerSet {
  private readonly workers: RuntimeWorker[];

  constructor(private readonly deps: RuntimeWorkerDependencies) {
    this.workers = this.buildWorkers();
  }

  start(): void {
    for (const worker of this.workers) {
      worker.start();
    }
  }

  stop(): void {
    for (const worker of this.workers) {
      worker.stop();
    }
  }

  listIds(): string[] {
    return this.workers.map((worker) => worker.id);
  }

  private buildWorkers(): RuntimeWorker[] {
    const built: RuntimeWorker[] = [];
    const logger = this.deps.logger;
    const cfg = this.deps.config;

    if (cfg.WORKER_CANDLE_CLOSE_ENABLED) {
      built.push(
        new CandleCloseWorker({
          pairs: this.deps.pairs,
          timeframes: cfg.WORKER_CANDLE_CLOSE_TIMEFRAMES,
          tickMs: cfg.WORKER_CANDLE_CLOSE_TICK_MS,
          logger,
          onCandleClose: (pair, timeframe, bucket) =>
            this.deps.onCandleClose({ pair, timeframe, bucket }),
        }),
      );
    }

    if (cfg.WORKER_BREAKEVEN_ENABLED) {
      built.push(
        new BreakevenProtectionWorker({
          intervalMs: cfg.WORKER_BREAKEVEN_INTERVAL_MS,
          armPct: cfg.WORKER_BREAKEVEN_ARM_PCT,
          logger,
          getPositions: this.deps.getPositions,
          getMarkPrice: this.deps.getMarkPrice,
          onBreakevenArm: this.deps.onBreakevenArm,
        }),
      );
    }

    if (cfg.WORKER_FUNDING_ENABLED) {
      built.push(
        new FundingWindowWorker({
          intervalMs: cfg.WORKER_FUNDING_CHECK_INTERVAL_MS,
          leadMs: cfg.WORKER_FUNDING_LEAD_MS,
          windowsUtc: cfg.WORKER_FUNDING_WINDOWS_UTC.split(',').map((v) => v.trim()).filter(Boolean),
          logger,
          onFundingWindow: this.deps.onFundingWindow,
        }),
      );
    }

    return built;
  }
}
