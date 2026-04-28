import { describe, it, expect, vi } from 'vitest';
import { IntervalDriver } from '../../../src/strategy/scheduler/interval-driver';

describe('IntervalDriver', () => {
  it('calls runEvaluation per pair on interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new IntervalDriver({ runEvaluation: run });
    d.add({ id: 'a', pairs: ['p1', 'p2'], intervalMs: 1000 });
    d.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledWith('a', 'p1', { kind: 'interval' });
    expect(run).toHaveBeenCalledWith('a', 'p2', { kind: 'interval' });
    d.stop();
    vi.useRealTimers();
  });

  it('skips pair when previous evaluation still pending', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const d = new IntervalDriver({ runEvaluation: run });
    d.add({ id: 'a', pairs: ['p1'], intervalMs: 100 });
    d.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    d.stop();
    vi.useRealTimers();
  });

  it('stop halts further evaluations', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new IntervalDriver({ runEvaluation: run });
    d.add({ id: 'a', pairs: ['p1'], intervalMs: 100 });
    d.start();
    await vi.advanceTimersByTimeAsync(100);
    d.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
