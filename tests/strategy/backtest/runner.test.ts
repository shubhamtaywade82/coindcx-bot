import { describe, it, expect, vi } from 'vitest';
import { runBacktest } from '../../../src/strategy/backtest/runner';
import { CandleSource } from '../../../src/strategy/backtest/sources/candle-source';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Strategy } from '../../../src/strategy/types';

const fakeMarket: any = {
  htf: { trend: 'uptrend', swing_high: 110, swing_low: 90 },
  ltf: { trend: 'uptrend', bos: false, swing_high: 110, swing_low: 90,
    displacement: { present: false, strength: 'weak' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0,0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};

const fakeStrategy: Strategy = {
  manifest: { id: 'fake', version: '1', mode: 'bar_close', barTimeframes: ['1m'], pairs: ['p'], description: '' },
  evaluate: () => ({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' }),
};

describe('runBacktest', () => {
  it('runs strategy through CandleSource → simulator and writes CSV', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ts: 0, o: 100, h: 105, l: 95, c: 100 },
      { ts: 60_000, o: 100, h: 115, l: 99, c: 110 },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'f4-'));
    const csv = join(dir, 'trades.csv');
    const summary = await runBacktest({
      strategy: fakeStrategy,
      pair: 'p',
      dataSource: new CandleSource({ pair: 'p', tf: '1m', fromMs: 0, toMs: 120_000, fetcher }),
      buildMarketState: () => fakeMarket,
      pessimistic: true,
      outCsv: csv,
    });
    expect(summary.metrics.tradeCount).toBeGreaterThan(0);
    const content = readFileSync(csv, 'utf8');
    expect(content).toContain('openedAt');
    expect(summary.coverage).toBeGreaterThan(0);
  });
});
