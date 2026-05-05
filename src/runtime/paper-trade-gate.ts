import type { Pool } from 'pg';
import type { Signal } from '../signals/types';

const DAY_MS = 24 * 60 * 60_000;

const PAPER_TRADE_STATS_SQL = `
  SELECT
    COUNT(*)::int AS trade_count,
    MIN(ts) AS first_trade_ts,
    MAX(ts) AS latest_trade_ts
  FROM paper_trades
`;

const PAPER_TRADE_GO_LIVE_EVIDENCE_SQL = `
  SELECT
    COUNT(*) FILTER (
      WHERE payload#>>'{result,rMultiple}' ~ '^[-+]?([0-9]+(\\.[0-9]+)?|\\.[0-9]+)$'
    )::int AS expectancy_sample_size,
    AVG(
      CASE
        WHEN payload#>>'{result,rMultiple}' ~ '^[-+]?([0-9]+(\\.[0-9]+)?|\\.[0-9]+)$'
          THEN (payload#>>'{result,rMultiple}')::double precision
        ELSE NULL
      END
    ) AS expectancy_r,
    COUNT(*) FILTER (
      WHERE LOWER(COALESCE(payload#>>'{result,exitReason}', '')) IN
        ('sl', 'stop', 'stop_loss', 'time_stop_kill', 'ttl')
    )::int AS stop_exit_count,
    COUNT(*) FILTER (
      WHERE LOWER(COALESCE(payload#>>'{result,exitReason}', '')) IN
        ('sl', 'stop', 'stop_loss', 'time_stop_kill', 'ttl')
        AND LOWER(COALESCE(payload#>>'{result,reachedBreakevenLock}', '')) IN
          ('true', 't', '1')
    )::int AS stop_exit_with_breakeven_count,
    COUNT(*) FILTER (
      WHERE payload#>>'{result,maxDrawdownPct}' ~ '^[-+]?([0-9]+(\\.[0-9]+)?|\\.[0-9]+)$'
    )::int AS drawdown_sample_size,
    MAX(
      CASE
        WHEN payload#>>'{result,maxDrawdownPct}' ~ '^[-+]?([0-9]+(\\.[0-9]+)?|\\.[0-9]+)$'
          THEN
            CASE
              WHEN (payload#>>'{result,maxDrawdownPct}')::double precision > 1
                AND (payload#>>'{result,maxDrawdownPct}')::double precision <= 100
                THEN (payload#>>'{result,maxDrawdownPct}')::double precision / 100
              ELSE (payload#>>'{result,maxDrawdownPct}')::double precision
            END
        ELSE NULL
      END
    ) AS max_drawdown_pct
  FROM paper_trades
`;

interface PaperTradeStatsRow {
  trade_count: number;
  first_trade_ts: string | null;
  latest_trade_ts: string | null;
}

interface PaperTradeGoLiveEvidenceRow {
  expectancy_sample_size: number;
  expectancy_r: number | null;
  stop_exit_count: number;
  stop_exit_with_breakeven_count: number;
  drawdown_sample_size: number;
  max_drawdown_pct: number | null;
}

export interface PaperGoLiveCriteria {
  minBreakevenLockBeforeStopRate: number;
  minExpectancyR: number;
  maxDrawdownPct: number;
}

interface PaperGoLiveMetrics {
  expectancyR?: number;
  expectancySampleSize: number;
  breakevenLockBeforeStopRate?: number;
  stopExitCount: number;
  stopExitWithBreakevenCount: number;
  maxDrawdownPct?: number;
  drawdownSampleSize: number;
}

interface PaperGoLiveEvaluation {
  eligible: boolean;
  failedChecks: string[];
  metrics: PaperGoLiveMetrics;
  criteria: PaperGoLiveCriteria;
}

export interface PaperTradeGateSnapshot {
  minDays: number;
  tradeCount: number;
  firstTradeAt?: string;
  latestTradeAt?: string;
  windowEndsAt?: string;
  daysElapsed: number;
  daysRemaining: number;
  completed: boolean;
  evaluatedAt: string;
  goLive: PaperGoLiveEvaluation;
}

export interface PaperTradeGateOptions {
  minDays?: number;
  minBreakevenLockBeforeStopRate?: number;
  minExpectancyR?: number;
  maxDrawdownPct?: number;
}

const DEFAULT_GO_LIVE_CRITERIA: PaperGoLiveCriteria = {
  minBreakevenLockBeforeStopRate: 0.99,
  minExpectancyR: 0.4,
  maxDrawdownPct: 0.08,
};

function toRounded(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number(value.toFixed(6));
}

export class PaperTradeGate {
  private lastReportedDay = -1;
  private completionReported = false;
  private lastGoLiveDigest = '';
  private readonly minDays: number;
  private readonly criteria: PaperGoLiveCriteria;

  constructor(
    private readonly pool: Pool,
    minDaysOrOptions: number | PaperTradeGateOptions = 30,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof minDaysOrOptions === 'number') {
      this.minDays = minDaysOrOptions;
      this.criteria = { ...DEFAULT_GO_LIVE_CRITERIA };
      return;
    }
    this.minDays = minDaysOrOptions.minDays ?? 30;
    this.criteria = {
      minBreakevenLockBeforeStopRate:
        minDaysOrOptions.minBreakevenLockBeforeStopRate ??
        DEFAULT_GO_LIVE_CRITERIA.minBreakevenLockBeforeStopRate,
      minExpectancyR: minDaysOrOptions.minExpectancyR ?? DEFAULT_GO_LIVE_CRITERIA.minExpectancyR,
      maxDrawdownPct: minDaysOrOptions.maxDrawdownPct ?? DEFAULT_GO_LIVE_CRITERIA.maxDrawdownPct,
    };
  }

  async snapshot(): Promise<PaperTradeGateSnapshot> {
    const result = await this.pool.query<PaperTradeStatsRow>(PAPER_TRADE_STATS_SQL);
    const row = result.rows[0];
    const nowMs = this.clock();
    const evaluatedAt = new Date(nowMs).toISOString();
    if (!row || !row.first_trade_ts) {
      return {
        minDays: this.minDays,
        tradeCount: row?.trade_count ?? 0,
        daysElapsed: 0,
        daysRemaining: this.minDays,
        completed: false,
        evaluatedAt,
        goLive: this.evaluateGoLive({
          minDaysCompleted: false,
          evidence: undefined,
        }),
      };
    }

    const firstTradeMs = Date.parse(row.first_trade_ts);
    const latestTradeAt = row.latest_trade_ts ?? row.first_trade_ts;
    const elapsedMs = Math.max(0, nowMs - firstTradeMs);
    const daysElapsed = elapsedMs / DAY_MS;
    const completed = daysElapsed >= this.minDays;
    const evidenceResult = await this.pool.query<PaperTradeGoLiveEvidenceRow>(
      PAPER_TRADE_GO_LIVE_EVIDENCE_SQL,
    );
    const daysRemaining = completed ? 0 : Math.max(0, this.minDays - daysElapsed);
    return {
      minDays: this.minDays,
      tradeCount: row.trade_count,
      firstTradeAt: row.first_trade_ts,
      latestTradeAt,
      windowEndsAt: new Date(firstTradeMs + this.minDays * DAY_MS).toISOString(),
      daysElapsed,
      daysRemaining,
      completed,
      evaluatedAt,
      goLive: this.evaluateGoLive({
        minDaysCompleted: completed,
        evidence: evidenceResult.rows[0],
      }),
    };
  }

  async progressSignalIfChanged(): Promise<Signal | null> {
    const snapshot = await this.snapshot();
    return this.progressSignalFromSnapshot(snapshot);
  }

  async goLiveSignalIfChanged(): Promise<Signal | null> {
    const snapshot = await this.snapshot();
    return this.goLiveSignalFromSnapshot(snapshot);
  }

  async signalsIfChanged(): Promise<Signal[]> {
    const snapshot = await this.snapshot();
    const signals: Signal[] = [];
    const progressSignal = this.progressSignalFromSnapshot(snapshot);
    if (progressSignal) signals.push(progressSignal);
    const goLiveSignal = this.goLiveSignalFromSnapshot(snapshot);
    if (goLiveSignal) signals.push(goLiveSignal);
    return signals;
  }

  private progressSignalFromSnapshot(snapshot: PaperTradeGateSnapshot): Signal | null {
    if (snapshot.tradeCount === 0) return null;
    const completed = snapshot.completed;
    const elapsedDayBucket = Math.floor(snapshot.daysElapsed);
    const dayChanged = elapsedDayBucket > this.lastReportedDay;
    const completionChanged = completed && !this.completionReported;
    if (!dayChanged && !completionChanged) return null;

    this.lastReportedDay = elapsedDayBucket;
    if (completed) this.completionReported = true;
    return {
      id: `risk:paper-run-progress:${snapshot.evaluatedAt}:${snapshot.tradeCount}:${elapsedDayBucket}`,
      ts: snapshot.evaluatedAt,
      strategy: 'risk.paper_gate',
      type: 'risk.paper_run_progress',
      severity: completed ? 'info' : 'warn',
      payload: {
        minDays: snapshot.minDays,
        tradeCount: snapshot.tradeCount,
        firstTradeAt: snapshot.firstTradeAt,
        latestTradeAt: snapshot.latestTradeAt,
        windowEndsAt: snapshot.windowEndsAt,
        daysElapsed: Number(snapshot.daysElapsed.toFixed(6)),
        daysRemaining: Number(snapshot.daysRemaining.toFixed(6)),
        completed: snapshot.completed,
      },
    };
  }

  private goLiveSignalFromSnapshot(snapshot: PaperTradeGateSnapshot): Signal | null {
    if (snapshot.tradeCount === 0) return null;
    const goLive = snapshot.goLive;
    const metricDigest = [
      snapshot.completed ? '1' : '0',
      goLive.eligible ? '1' : '0',
      goLive.failedChecks.join('|'),
      String(Math.floor(snapshot.daysElapsed)),
      String(goLive.metrics.expectancySampleSize),
      String(goLive.metrics.stopExitCount),
      String(goLive.metrics.drawdownSampleSize),
      String(toRounded(goLive.metrics.expectancyR) ?? 'na'),
      String(toRounded(goLive.metrics.breakevenLockBeforeStopRate) ?? 'na'),
      String(toRounded(goLive.metrics.maxDrawdownPct) ?? 'na'),
    ].join(':');
    if (metricDigest === this.lastGoLiveDigest) return null;
    this.lastGoLiveDigest = metricDigest;
    return {
      id: `risk:paper-go-live-gate:${snapshot.evaluatedAt}:${snapshot.tradeCount}`,
      ts: snapshot.evaluatedAt,
      strategy: 'risk.paper_gate',
      type: 'risk.paper_go_live_gate',
      severity: goLive.eligible ? 'info' : 'warn',
      payload: {
        minDays: snapshot.minDays,
        daysElapsed: Number(snapshot.daysElapsed.toFixed(6)),
        completedMinimumDays: snapshot.completed,
        tradeCount: snapshot.tradeCount,
        eligible: goLive.eligible,
        failedChecks: goLive.failedChecks,
        criteria: {
          minBreakevenLockBeforeStopRate: goLive.criteria.minBreakevenLockBeforeStopRate,
          minExpectancyR: goLive.criteria.minExpectancyR,
          maxDrawdownPct: goLive.criteria.maxDrawdownPct,
        },
        metrics: {
          expectancyR: toRounded(goLive.metrics.expectancyR),
          expectancySampleSize: goLive.metrics.expectancySampleSize,
          breakevenLockBeforeStopRate: toRounded(goLive.metrics.breakevenLockBeforeStopRate),
          stopExitCount: goLive.metrics.stopExitCount,
          stopExitWithBreakevenCount: goLive.metrics.stopExitWithBreakevenCount,
          maxDrawdownPct: toRounded(goLive.metrics.maxDrawdownPct),
          drawdownSampleSize: goLive.metrics.drawdownSampleSize,
        },
      },
    };
  }

  private evaluateGoLive(input: {
    minDaysCompleted: boolean;
    evidence?: PaperTradeGoLiveEvidenceRow;
  }): PaperGoLiveEvaluation {
    const expectancySampleSize = input.evidence?.expectancy_sample_size ?? 0;
    const expectancyR =
      input.evidence?.expectancy_r !== null && input.evidence?.expectancy_r !== undefined
        ? input.evidence.expectancy_r
        : undefined;
    const stopExitCount = input.evidence?.stop_exit_count ?? 0;
    const stopExitWithBreakevenCount = input.evidence?.stop_exit_with_breakeven_count ?? 0;
    const breakevenLockBeforeStopRate =
      stopExitCount > 0 ? stopExitWithBreakevenCount / stopExitCount : undefined;
    const drawdownSampleSize = input.evidence?.drawdown_sample_size ?? 0;
    const maxDrawdownPct =
      input.evidence?.max_drawdown_pct !== null && input.evidence?.max_drawdown_pct !== undefined
        ? input.evidence.max_drawdown_pct
        : undefined;

    const failedChecks: string[] = [];
    if (!input.minDaysCompleted) failedChecks.push('minimum_days_not_met');
    if (breakevenLockBeforeStopRate === undefined) {
      failedChecks.push('breakeven_lock_before_stop_evidence_missing');
    } else if (breakevenLockBeforeStopRate < this.criteria.minBreakevenLockBeforeStopRate) {
      failedChecks.push('breakeven_lock_before_stop_below_threshold');
    }
    if (expectancyR === undefined) {
      failedChecks.push('expectancy_evidence_missing');
    } else if (expectancyR < this.criteria.minExpectancyR) {
      failedChecks.push('expectancy_below_threshold');
    }
    if (maxDrawdownPct === undefined) {
      failedChecks.push('max_drawdown_evidence_missing');
    } else if (maxDrawdownPct >= this.criteria.maxDrawdownPct) {
      failedChecks.push('max_drawdown_above_threshold');
    }

    return {
      eligible: failedChecks.length === 0,
      failedChecks,
      criteria: this.criteria,
      metrics: {
        expectancyR,
        expectancySampleSize,
        breakevenLockBeforeStopRate,
        stopExitCount,
        stopExitWithBreakevenCount,
        maxDrawdownPct,
        drawdownSampleSize,
      },
    };
  }
}
