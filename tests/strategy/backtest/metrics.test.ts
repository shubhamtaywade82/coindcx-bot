import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../../src/strategy/backtest/metrics';
import type { ClosedTrade } from '../../../src/strategy/backtest/simulator';

const t = (pnl: number, openedAt: number, closedAt: number): ClosedTrade => ({
  side: pnl >= 0 ? 'LONG' : 'SHORT', entry: 100, stopLoss: 95, takeProfit: 110,
  openedAt, ttlMs: undefined, reason: 'r', closedAt, exitPrice: 100 + pnl, exitReason: pnl >= 0 ? 'tp' : 'sl', pnl,
});

describe('computeMetrics', () => {
  it('computes win rate, profit factor, max drawdown, total pnl', () => {
    const trades = [t(10, 0, 1), t(-5, 2, 3), t(15, 4, 5), t(-10, 6, 7)];
    const m = computeMetrics(trades);
    expect(m.totalPnl).toBe(10);
    expect(m.winRate).toBe(0.5);
    expect(m.profitFactor).toBeCloseTo(25 / 15, 5);
    expect(m.maxDrawdown).toBeGreaterThan(0);
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
