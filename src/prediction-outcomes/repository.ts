import type { Pool } from 'pg';
import type { Config } from '../config/schema';
import type { Signal } from '../signals/types';
import type { PredictionFeedback } from './types';
import type { ResolvedOutcome } from './resolve-from-bars';

/** Tradable signals we persist for TP/SL outcome scoring (offline ML + calibration). */
const OUTCOME_TRACKED = new Set([
  'llm.pulse.v1',
  'ai.conductor.v1',
  'smc.rule.v1',
  'ma.cross.v1',
  'trendline.breakout.v1',
  'bearish.smc.v1',
]);

/** Rolling adaptive min-confidence only for LLM strategies (has config baselines). */
export const ADAPTIVE_CONFIDENCE_STRATEGIES = new Set(['llm.pulse.v1', 'ai.conductor.v1']);

export interface PendingOutcomeRow {
  id: number;
  client_signal_id: string;
  strategy: string;
  pair: string;
  signal_ts: Date;
  side: 'LONG' | 'SHORT';
  entry: string;
  stop_loss: string;
  take_profit: string;
  ttl_ms: string;
}

export class PredictionOutcomeRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  static shouldTrack(signal: Signal): boolean {
    if (!signal.pair) return false;
    if (!OUTCOME_TRACKED.has(signal.strategy)) return false;
    if (signal.type !== 'strategy.long' && signal.type !== 'strategy.short') return false;
    const p = signal.payload ?? {};
    const entry = Number(p.entry);
    const sl = Number(p.stopLoss ?? p.stop_loss);
    const tp = Number(p.takeProfit ?? p.take_profit);
    return Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp);
  }

  /** Serializable subset of the signal for offline ML / exports (no secrets). */
  static buildFeatureSnapshot(signal: Signal): Record<string, unknown> {
    const p = signal.payload ?? {};
    const meta = p.meta;
    return {
      strategy: signal.strategy,
      pair: signal.pair,
      type: signal.type,
      severity: signal.severity,
      confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 2000) : undefined,
      manifestVersion: p.manifestVersion,
      ttlMs: p.ttlMs,
      meta: meta && typeof meta === 'object' ? meta : undefined,
    };
  }

  async insertPending(signal: Signal): Promise<void> {
    if (!PredictionOutcomeRepository.shouldTrack(signal) || !signal.pair) return;
    const id = String(signal.payload?.clientSignalId ?? signal.id);
    const p = signal.payload;
    const side = signal.type === 'strategy.long' ? 'LONG' : 'SHORT';
    const ttl = Number(p?.ttlMs ?? 5 * 60_000);
    const featureSnapshot = PredictionOutcomeRepository.buildFeatureSnapshot(signal);
    await this.pool.query(
      `INSERT INTO strategy_prediction_outcomes (
        client_signal_id, strategy, pair, signal_ts, side, entry, stop_loss, take_profit, ttl_ms, status, feature_snapshot
      ) VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9,'pending', $10::jsonb)
      ON CONFLICT (client_signal_id) DO NOTHING`,
      [
        id,
        signal.strategy,
        signal.pair,
        signal.ts,
        side,
        String(p.entry),
        String(p.stopLoss ?? ''),
        String(p.takeProfit ?? ''),
        Number.isFinite(ttl) ? Math.floor(ttl) : 5 * 60_000,
        JSON.stringify(featureSnapshot),
      ],
    );
  }

  async listPending(limit = 40): Promise<PendingOutcomeRow[]> {
    const r = await this.pool.query(
      `SELECT id, client_signal_id, strategy, pair, signal_ts, side,
              entry::text AS entry, stop_loss::text AS stop_loss, take_profit::text AS take_profit, ttl_ms::text AS ttl_ms
       FROM strategy_prediction_outcomes
       WHERE status = 'pending'
       ORDER BY signal_ts ASC
       LIMIT $1`,
      [limit],
    );
    return r.rows as PendingOutcomeRow[];
  }

  async markResolved(id: number, outcome: ResolvedOutcome, barsExamined: number): Promise<void> {
    await this.pool.query(
      `UPDATE strategy_prediction_outcomes
       SET status = 'resolved', outcome = $2, resolved_ts = now(), bars_examined = $3
       WHERE id = $1`,
      [id, outcome, barsExamined],
    );
  }

  async loadFeedbackForPair(pair: string, config: Config): Promise<PredictionFeedback> {
    const r = await this.pool.query(
      `SELECT strategy, side, outcome, resolved_ts
       FROM strategy_prediction_outcomes
       WHERE pair = $1 AND strategy = ANY($2::text[]) AND status = 'resolved' AND outcome IS NOT NULL
       ORDER BY resolved_ts DESC NULLS LAST
       LIMIT 14`,
      [pair, [...OUTCOME_TRACKED]],
    );
    const recent_resolved = r.rows.map((row: any) => ({
      strategy: String(row.strategy),
      side: String(row.side),
      outcome: row.outcome as PredictionFeedback['recent_resolved'][0]['outcome'],
      resolved_at_iso: row.resolved_ts ? new Date(row.resolved_ts).toISOString() : null,
    }));
    const wins_vs_losses = {
      tp_first: recent_resolved.filter(x => x.outcome === 'tp_first').length,
      sl_first: recent_resolved.filter(x => x.outcome === 'sl_first').length,
      ttl_neutral: recent_resolved.filter(x => x.outcome === 'ttl_neutral').length,
      invalid_geometry: recent_resolved.filter(x => x.outcome === 'invalid_geometry').length,
      sample_n: recent_resolved.length,
    };

    const llm = await this.getAdaptiveMin(pair, 'llm.pulse.v1');
    const cond = await this.getAdaptiveMin(pair, 'ai.conductor.v1');

    return {
      recent_resolved,
      wins_vs_losses,
      adaptive_min_confidence_llm: config.PREDICTION_ADAPTIVE_ENABLED ? llm ?? null : null,
      adaptive_min_confidence_conductor: config.PREDICTION_ADAPTIVE_ENABLED ? cond ?? null : null,
    };
  }

  private async getAdaptiveMin(pair: string, strategyId: string): Promise<number | null> {
    const r = await this.pool.query(
      `SELECT min_confidence::float8 AS m FROM strategy_adaptive_confidence WHERE pair = $1 AND strategy_id = $2`,
      [pair, strategyId],
    );
    const m = r.rows[0]?.m;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
  }

  async upsertAdaptiveMin(pair: string, strategyId: string, minConfidence: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO strategy_adaptive_confidence (pair, strategy_id, min_confidence, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (pair, strategy_id) DO UPDATE SET
         min_confidence = EXCLUDED.min_confidence,
         updated_at = now()`,
      [pair, strategyId, minConfidence],
    );
  }

  async refreshAdaptiveForStrategy(pair: string, strategyId: string, config: Config): Promise<void> {
    if (!config.PREDICTION_ADAPTIVE_ENABLED) return;
    const r = await this.pool.query(
      `SELECT outcome FROM strategy_prediction_outcomes
       WHERE pair = $1 AND strategy = $2 AND status = 'resolved'
         AND outcome IN ('tp_first','sl_first')
       ORDER BY resolved_ts DESC NULLS LAST
       LIMIT 18`,
      [pair, strategyId],
    );
    const rows = r.rows as { outcome: string }[];
    if (rows.length < 5) return;

    const tp = rows.filter(x => x.outcome === 'tp_first').length;
    const sl = rows.filter(x => x.outcome === 'sl_first').length;
    const rate = tp / (tp + sl);

    const baseline =
      strategyId === 'ai.conductor.v1'
        ? config.AI_CONDUCTOR_MIN_CONFIDENCE
        : config.LLM_PULSE_ADAPTIVE_BASE_CONFIDENCE;

    const currentRow = await this.pool.query(
      `SELECT min_confidence::float8 AS m FROM strategy_adaptive_confidence WHERE pair = $1 AND strategy_id = $2`,
      [pair, strategyId],
    );
    const current = typeof currentRow.rows[0]?.m === 'number' ? currentRow.rows[0].m : baseline;

    let next = current;
    if (rate < 0.36) next = Math.min(config.PREDICTION_ADAPTIVE_MAX_CONFIDENCE, current + 0.04);
    if (rate > 0.58) next = Math.max(config.PREDICTION_ADAPTIVE_MIN_FLOOR, current - 0.03);

    if (Math.abs(next - current) >= 0.005) {
      await this.upsertAdaptiveMin(pair, strategyId, next);
    }
  }
}
