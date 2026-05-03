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

interface PaperTradeStatsRow {
  trade_count: number;
  first_trade_ts: string | null;
  latest_trade_ts: string | null;
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
}

export class PaperTradeGate {
  private lastReportedDay = -1;
  private completionReported = false;

  constructor(
    private readonly pool: Pool,
    private readonly minDays: number = 30,
    private readonly clock: () => number = Date.now,
  ) {}

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
      };
    }

    const firstTradeMs = Date.parse(row.first_trade_ts);
    const latestTradeAt = row.latest_trade_ts ?? row.first_trade_ts;
    const elapsedMs = Math.max(0, nowMs - firstTradeMs);
    const daysElapsed = elapsedMs / DAY_MS;
    const completed = daysElapsed >= this.minDays;
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
    };
  }

  async progressSignalIfChanged(): Promise<Signal | null> {
    const snapshot = await this.snapshot();
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
}
