import type { Signal } from '../signals/types';
import type { Sink } from './types';
import { PredictionOutcomeRepository } from '../prediction-outcomes/repository';

/**
 * Records tradable strategy signals (tracked ids) so a resolver can score TP vs SL on 15m candles later.
 */
export class PredictionOutcomePendingSink implements Sink {
  readonly name = 'prediction_outcome_pending';

  constructor(private readonly repo: PredictionOutcomeRepository) {}

  async emit(signal: Signal): Promise<void> {
    if (!PredictionOutcomeRepository.shouldTrack(signal)) return;
    await this.repo.insertPending(signal);
  }
}
