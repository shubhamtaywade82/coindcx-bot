import { describe, expect, it, vi } from 'vitest';
import { PaperTradeGate } from '../../src/runtime/paper-trade-gate';

describe('PaperTradeGate', () => {
  it('returns no signal when no paper trades exist', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ trade_count: 0, first_trade_ts: null, latest_trade_ts: null }],
      })),
    };
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.progressSignalIfChanged();
    expect(signal).toBeNull();
  });

  it('emits progress signal while minimum-day gate is incomplete', async () => {
    const firstTradeTs = '2026-04-29T00:00:00.000Z';
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ trade_count: 12, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:00:00.000Z' }],
      })),
    };
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
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ trade_count: 55, first_trade_ts: firstTradeTs, latest_trade_ts: '2026-05-02T23:59:00.000Z' }],
      })),
    };
    const gate = new PaperTradeGate(pool as any, 30, () => Date.parse('2026-05-03T00:00:00.000Z'));
    const signal = await gate.progressSignalIfChanged();
    expect(signal).toBeTruthy();
    expect(signal?.type).toBe('risk.paper_run_progress');
    expect(signal?.severity).toBe('info');
    expect(signal?.payload.completed).toBe(true);
    expect(signal?.payload.daysRemaining).toBe(0);
  });
});
