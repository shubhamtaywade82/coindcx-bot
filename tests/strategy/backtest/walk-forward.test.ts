import { describe, expect, it } from 'vitest';
import { runWalkForwardValidation } from '../../../src/strategy/backtest/walk-forward';
import type { BacktestSummary } from '../../../src/strategy/backtest/runner';
import type { DataSource } from '../../../src/strategy/backtest/types';

class EmptySource implements DataSource {
  async *iterate() {}

  coverage(): number {
    return 1;
  }
}

function summary(sharpe: number): BacktestSummary {
  return {
    coverage: 1,
    events: 10,
    metrics: {
      totalPnl: 10,
      tradeCount: 5,
      winRate: 0.6,
      avgR: 0.8,
      profitFactor: 1.4,
      sharpe,
      calmar: 1.1,
      maxDrawdown: 4,
      maxDrawdownPct: 0.04,
      annualizedReturn: 20,
      medianTimeToOneRMs: 60_000,
      breakevenLockBeforeNegativeCloseRate: 1,
      avgWin: 6,
      avgLoss: 3,
    },
  };
}

describe('runWalkForwardValidation', () => {
  it('accepts when all OOS windows meet minimum Sharpe ratio', async () => {
    const result = await runWalkForwardValidation({
      fromMs: Date.parse('2025-01-01T00:00:00Z'),
      toMs: Date.parse('2026-03-01T00:00:00Z'),
      inSampleMonths: 6,
      outOfSampleMonths: 1,
      minOosSharpeFactor: 0.5,
      outputDir: '/tmp',
      outputPrefix: 'wf',
      buildDataSource: () => new EmptySource(),
      runWindowBacktest: async ({ phase }) => (phase === 'in_sample' ? summary(1.0) : summary(0.6)),
    });
    expect(result.accepted).toBe(true);
    expect(result.windows.length).toBeGreaterThan(0);
  });

  it('rejects when OOS Sharpe drops below 0.5x IS Sharpe', async () => {
    const result = await runWalkForwardValidation({
      fromMs: Date.parse('2025-01-01T00:00:00Z'),
      toMs: Date.parse('2026-03-01T00:00:00Z'),
      inSampleMonths: 6,
      outOfSampleMonths: 1,
      minOosSharpeFactor: 0.5,
      outputDir: '/tmp',
      outputPrefix: 'wf',
      buildDataSource: () => new EmptySource(),
      runWindowBacktest: async ({ phase }) => (phase === 'in_sample' ? summary(1.2) : summary(0.4)),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toMatch(/OOS Sharpe/);
  });
});
