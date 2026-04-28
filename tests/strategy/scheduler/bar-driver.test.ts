import { describe, it, expect, vi } from 'vitest';
import { BarDriver, tfMs } from '../../../src/strategy/scheduler/bar-driver';

describe('tfMs', () => {
  it('parses standard timeframes', () => {
    expect(tfMs('1m')).toBe(60_000);
    expect(tfMs('5m')).toBe(5 * 60_000);
    expect(tfMs('15m')).toBe(15 * 60_000);
    expect(tfMs('1h')).toBe(60 * 60_000);
  });
});

describe('BarDriver', () => {
  it('fires bar_close once per crossed boundary', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new BarDriver({ runEvaluation: run });
    d.add({ id: 's', pairs: ['p'], timeframes: ['1m'] });
    d.tradeAt('p', 30_000);
    expect(run).not.toHaveBeenCalled();
    d.tradeAt('p', 60_500);
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledWith('s', 'p', { kind: 'bar_close', tf: '1m' });
    d.tradeAt('p', 70_000);
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
