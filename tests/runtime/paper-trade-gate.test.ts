import { describe, expect, it, vi } from 'vitest';
import { PaperTradeGate } from '../../src/runtime/paper-trade-gate';

describe('PaperTradeGate', () => {
  function createPool(rowsByCall: Array<{ rows: unknown[] }>) {
    return {
      query: vi.fn(async () => rowsByCall.shift() ?? { rows: [] }),
    };
  }

  it('returns no signal when no paper trades exist', async () => {
    const pool = createPool([
      { rows: [{ trade_count: 0, first_trade_ts: null, latest_trade_ts: null }] },
    ]);
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.progressSignalIfChanged();
    expect(signal).toBeNull();
  });

  it('emits progress signal while minimum-day gate is incomplete', async () => {
    const firstTradeTs = '2026-04-29T00:00:00.000Z';
    const pool = createPool([
      {
        rows: [
          { trade_count: 12, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:00:00.000Z' },
        ],
      },
      {
        rows: [{
          expectancy_sample_size: 0,
          expectancy_r: null,
          stop_exit_count: 0,
          stop_exit_with_breakeven_count: 0,
          drawdown_sample_size: 0,
          max_drawdown_pct: null,
        }],
      },
    ]);
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.progressSignalIfChanged();
    expect(signal).toBeTruthy();
    expect(signal?.type).toBe('risk.paper_run_progress');
    expect(signal?.severity).toBe('warn');
    expect(signal?.payload.completed).toBe(false);
    expect(signal?.payload.minDays).toBe(30);
    expect(signal?.payload.tradeCount).toBe(12);
  });

  it('emits completion signal when minimum-day gate is met', async () => {
    const firstTradeTs = '2026-03-01T00:00:00.000Z';
    const pool = createPool([
      {
        rows: [
          { trade_count: 55, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:59:00.000Z' },
        ],
      },
      {
        rows: [{
          expectancy_sample_size: 0,
          expectancy_r: null,
          stop_exit_count: 0,
          stop_exit_with_breakeven_count: 0,
          drawdown_sample_size: 0,
          max_drawdown_pct: null,
        }],
      },
    ]);
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.progressSignalIfChanged();
    expect(signal).toBeTruthy();
    expect(signal?.type).toBe('risk.paper_run_progress');
    expect(signal?.severity).toBe('info');
    expect(signal?.payload.completed).toBe(true);
    expect(signal?.payload.daysRemaining).toBe(0);
  });

  it('emits go-live gate warning when evidence is insufficient or below thresholds', async () => {
    const firstTradeTs = '2026-03-01T00:00:00.000Z';
    const pool = createPool([
      {
        rows: [
          { trade_count: 4, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:59:00.000Z' },
        ],
      },
      {
        rows: [{
          expectancy_sample_size: 2,
          expectancy_r: 0.15,
          stop_exit_count: 2,
          stop_exit_with_breakeven_count: 0,
          drawdown_sample_size: 2,
          max_drawdown_pct: 0.09,
        }],
      },
    ]);
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.goLiveSignalIfChanged();
    expect(signal).toBeTruthy();
    expect(signal?.type).toBe('risk.paper_go_live_gate');
    expect(signal?.severity).toBe('warn');
    expect(signal?.payload.eligible).toBe(false);
    expect(signal?.payload.failedChecks).toEqual(
      expect.arrayContaining([
        'breakeven_lock_before_stop_below_threshold',
        'expectancy_below_threshold',
        'max_drawdown_above_threshold',
      ]),
    );
  });

  it('emits go-live gate info when all criteria are met', async () => {
    const firstTradeTs = '2026-03-01T00:00:00.000Z';
    const pool = createPool([
      {
        rows: [
          { trade_count: 3, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:59:00.000Z' },
        ],
      },
      {
        rows: [{
          expectancy_sample_size: 3,
          expectancy_r: 0.5,
          stop_exit_count: 3,
          stop_exit_with_breakeven_count: 3,
          drawdown_sample_size: 3,
          max_drawdown_pct: 0.05,
        }],
      },
    ]);
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.goLiveSignalIfChanged();
    expect(signal).toBeTruthy();
    expect(signal?.type).toBe('risk.paper_go_live_gate');
    expect(signal?.severity).toBe('info');
    expect(signal?.payload.eligible).toBe(true);
    expect(signal?.payload.failedChecks).toEqual([]);
  });

  it('returns both signals when both progress and go-live state changed', async () => {
    const firstTradeTs = '2026-03-01T00:00:00.000Z';
    const pool = createPool([
      {
        rows: [
          { trade_count: 3, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:59:00.000Z' },
        ],
      },
      {
        rows: [{
          expectancy_sample_size: 1,
          expectancy_r: 0.6,
          stop_exit_count: 1,
          stop_exit_with_breakeven_count: 1,
          drawdown_sample_size: 1,
          max_drawdown_pct: 0.03,
        }],
      },
    ]);
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signals = await gate.signalsIfChanged();
    expect(signals.map((signal) => signal.type)).toEqual([
      'risk.paper_run_progress',
      'risk.paper_go_live_gate',
    ]);
  });
});
