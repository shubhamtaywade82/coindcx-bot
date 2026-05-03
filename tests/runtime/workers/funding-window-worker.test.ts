import { describe, expect, it, vi } from 'vitest';
import { FundingWindowWorker } from '../../../src/runtime/workers/funding-window-worker';

const loggerStub = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
  level: 'info',
} as any;

describe('FundingWindowWorker', () => {
  it('fires once when entering lead window', async () => {
    vi.useFakeTimers();
    const onFundingWindow = vi.fn().mockResolvedValue(undefined);
    const now = Date.parse('2026-05-03T03:55:10.000Z');
    const worker = new FundingWindowWorker({
      intervalMs: 1000,
      leadMs: 5 * 60_000,
      windowsUtc: ['04:00'],
      logger: loggerStub,
      clock: () => now,
      onFundingWindow,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(onFundingWindow).toHaveBeenCalledTimes(1);
    expect(onFundingWindow).toHaveBeenCalledWith({
      windowIso: '2026-05-03T04:00:00.000Z',
      leadMs: 300000,
    });

    worker.stop();
    vi.useRealTimers();
  });

  it('can trigger next-day funding windows', async () => {
    vi.useFakeTimers();
    let now = Date.parse('2026-05-03T21:58:00.000Z');
    const onFundingWindow = vi.fn().mockResolvedValue(undefined);
    const worker = new FundingWindowWorker({
      intervalMs: 1000,
      leadMs: 120_000,
      windowsUtc: ['22:00'],
      logger: loggerStub,
      clock: () => now,
      onFundingWindow,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFundingWindow).toHaveBeenCalledTimes(1);

    now = Date.parse('2026-05-03T22:01:00.000Z');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFundingWindow).toHaveBeenCalledTimes(1);

    now = Date.parse('2026-05-04T21:58:10.000Z');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFundingWindow).toHaveBeenCalledTimes(2);

    worker.stop();
    vi.useRealTimers();
  });
});
