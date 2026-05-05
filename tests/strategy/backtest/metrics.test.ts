import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../../src/strategy/backtest/metrics';
import type { ClosedTrade } from '../../../src/strategy/backtest/simulator';

const t = (pnl: number, openedAt: number, closedAt: number): ClosedTrade => ({
  side: pnl >= 0 ? 'LONG' : 'SHORT', entry: 100, stopLoss: 95, takeProfit: 110,
  riskPerUnit: 5,
  breakevenLockPrice: 105,
  openedAt,
  ttlMs: undefined,
  reason: 'r',
  ...(pnl >= 5 ? { reachedBreakevenLockAt: openedAt + 60_000 } : {}),
  closedAt,
  exitPrice: 100 + pnl,
  exitReason: pnl >= 0 ? 'tp' : 'sl',
  pnl,
  rMultiple: pnl / 5,
  reachedBreakevenLock: pnl >= 5,
  ...(pnl >= 5 ? { timeToOneRMs: 60_000 } : {}),
  closedInNegativePnl: pnl < 0,
});

describe('computeMetrics', () => {
  it('computes win rate, profit factor, max drawdown, total pnl', () => {
    const trades = [t(10, 0, 1), t(-5, 2, 3), t(15, 4, 5), t(-10, 6, 7)];
    const m = computeMetrics(trades);
    expect(m.totalPnl).toBe(10);
    expect(m.winRate).toBe(0.5);
    expect(m.avgR).toBeCloseTo(0.5, 5);
    expect(m.profitFactor).toBeCloseTo(25 / 15, 5);
    expect(m.maxDrawdown).toBeGreaterThan(0);
    expect(m.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(m.breakevenLockBeforeNegativeCloseRate).toBeGreaterThanOrEqual(0);
    expect(m.tradeCount).toBe(4);
  });

  it('handles empty ledger', () => {
    const m = computeMetrics([]);
    expect(m.totalPnl).toBe(0);
    expect(m.tradeCount).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.sharpe).toBe(0);
  });
});
