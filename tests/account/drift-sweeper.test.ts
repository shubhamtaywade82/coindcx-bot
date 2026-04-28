import { describe, it, expect, vi } from 'vitest';
import { DriftSweeper } from '../../src/account/drift-sweeper';

describe('DriftSweeper', () => {
  it('schedules sweeps on the configured interval', async () => {
    vi.useFakeTimers();
    const onSweep = vi.fn().mockResolvedValue(undefined);
    const tryAcquire = vi.fn().mockResolvedValue(true);
    const s = new DriftSweeper({ intervalMs: 1000, onSweep, tryAcquire });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSweep).toHaveBeenCalledTimes(2);
    s.stop();
    vi.useRealTimers();
  });

  it('skips sweep when bucket cannot be acquired', async () => {
    vi.useFakeTimers();
    const onSweep = vi.fn().mockResolvedValue(undefined);
    const tryAcquire = vi.fn().mockResolvedValue(false);
    const s = new DriftSweeper({ intervalMs: 1000, onSweep, tryAcquire });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSweep).not.toHaveBeenCalled();
    s.stop();
    vi.useRealTimers();
  });

  it('stop prevents further sweeps', async () => {
    vi.useFakeTimers();
    const onSweep = vi.fn().mockResolvedValue(undefined);
    const tryAcquire = vi.fn().mockResolvedValue(true);
    const s = new DriftSweeper({ intervalMs: 1000, onSweep, tryAcquire });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    s.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSweep).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
