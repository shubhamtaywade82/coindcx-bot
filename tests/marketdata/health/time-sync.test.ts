import { describe, it, expect, vi } from 'vitest';
import { TimeSync } from '../../../src/marketdata/health/time-sync';

describe('TimeSync', () => {
  it('fires critical alert when skew exceeds threshold', async () => {
    const onSkew = vi.fn();
    const ts = new TimeSync({
      thresholdMs: 100,
      fetchExchangeMs: async () => 1_000_000,
      fetchNtpMs:      async () => 1_000_000,
      now: () => 1_000_500,
      onSkew,
    });
    await ts.checkOnce();
    expect(onSkew).toHaveBeenCalled();
    const arg = onSkew.mock.calls[0]![0];
    expect(arg.severity).toBe('critical');
    expect(Math.abs(arg.localVsExchange)).toBeGreaterThanOrEqual(500);
  });

  it('silent when within threshold', async () => {
    const onSkew = vi.fn();
    const ts = new TimeSync({
      thresholdMs: 1000,
      fetchExchangeMs: async () => 1_000_000,
      fetchNtpMs:      async () => 1_000_000,
      now: () => 1_000_000,
      onSkew,
    });
    await ts.checkOnce();
    expect(onSkew).not.toHaveBeenCalled();
  });

  it('warns when one source unavailable', async () => {
    const onSkew = vi.fn();
    const ts = new TimeSync({
      thresholdMs: 1000,
      fetchExchangeMs: async () => { throw new Error('down'); },
      fetchNtpMs:      async () => 1_000_000,
      now: () => 1_000_000,
      onSkew,
    });
    await ts.checkOnce();
    expect(onSkew).toHaveBeenCalled();
    expect(onSkew.mock.calls[0]![0].severity).toBe('warn');
  });
});
