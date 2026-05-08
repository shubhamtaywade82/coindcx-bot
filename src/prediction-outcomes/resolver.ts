import type { AppLogger } from '../logging/logger';
import type { Config } from '../config/schema';
import type { Candle } from '../ai/state-builder';
import {
  ADAPTIVE_CONFIDENCE_STRATEGIES,
  type PendingOutcomeRow,
  type PredictionOutcomeRepository,
} from './repository';
import { resolvePredictionOn15mBars } from './resolve-from-bars';
import type { ResolvedOutcome } from './resolve-from-bars';

export interface PredictionOutcomeResolverOpts {
  repo: PredictionOutcomeRepository;
  config: Config;
  logger: AppLogger;
  /** Oldest-first 15m candles for the pair */
  getBars15m: (pair: string) => Candle[];
  clock?: () => number;
}

export class PredictionOutcomeResolver {
  constructor(private readonly opts: PredictionOutcomeResolverOpts) {}

  async tick(): Promise<void> {
    if (!this.opts.config.PREDICTION_OUTCOME_ENABLED) return;
    const rows = await this.opts.repo.listPending(50);
    const nowMs = (this.opts.clock ?? Date.now)();
    for (const row of rows) {
      try {
        await this.resolveOne(row, nowMs);
      } catch (err: any) {
        this.opts.logger.warn(
          { mod: 'prediction_outcomes', err: err?.message, id: row.id },
          'resolve row failed',
        );
      }
    }
  }

  private async resolveOne(row: PendingOutcomeRow, nowMs: number): Promise<void> {
    const bars = this.opts.getBars15m(row.pair);
    const signalMs = new Date(row.signal_ts).getTime();
    const ttl = Number(row.ttl_ms);
    const entry = Number(row.entry);
    const sl = Number(row.stop_loss);
    const tp = Number(row.take_profit);
    const side = row.side;

    const { outcome, barsExamined } = resolvePredictionOn15mBars({
      side,
      entry,
      sl,
      tp,
      signalMs,
      ttlMs: Number.isFinite(ttl) ? ttl : 5 * 60_000,
      nowMs,
      bars15m: bars,
    });

    if (outcome === 'pending') return;

    await this.opts.repo.markResolved(row.id, outcome as ResolvedOutcome, barsExamined);
    if (outcome !== 'invalid_geometry' && ADAPTIVE_CONFIDENCE_STRATEGIES.has(row.strategy)) {
      await this.opts.repo.refreshAdaptiveForStrategy(row.pair, row.strategy, this.opts.config);
    }
  }
}
