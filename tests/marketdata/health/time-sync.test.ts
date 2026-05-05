import { describe, it, expect, vi } from 'vitest';
import { TimeSync } from '../../../src/marketdata/health/time-sync';

describe('TimeSync', () => {
  it('does not fire skew_exceeded when only exchange and NTP disagree (not host clock)', async () => {
    const onSkew = vi.fn();
    const local = 1_000_000;
    const sync = new TimeSync({
      thresholdMs: 500,
      now: () => local,
      fetchExchangeMs: async () => local,
      fetchNtpMs: async () => local + 5_000,
      onSkew,
    });
    await sync.checkOnce();
    expect(onSkew).not.toHaveBeenCalled();
  });

  it('fires skew_exceeded from local vs exchange when NTP is unavailable', async () => {
    const onSkew = vi.fn();
    const local = 10_000;
    const sync = new TimeSync({
      thresholdMs: 100,
      now: () => local,
      fetchExchangeMs: async () => local - 500,
      fetchNtpMs: async () => {
        throw new Error('ntp blocked');
      },
      onSkew,
    });
    await sync.checkOnce();
    expect(onSkew).toHaveBeenCalledTimes(1);
    expect(onSkew.mock.calls[0][0].severity).toBe('critical');
    expect(onSkew.mock.calls[0][0].reason).toBe('skew_exceeded');
  });

  it('warns ntp_unavailable when NTP fails but local matches exchange', async () => {
    const onSkew = vi.fn();
    const t = 5_000_000;
    const sync = new TimeSync({
      thresholdMs: 100,
      now: () => t,
      fetchExchangeMs: async () => t,
      fetchNtpMs: async () => {
        throw new Error('ntp blocked');
      },
      onSkew,
    });
    await sync.checkOnce();
    expect(onSkew).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn', reason: 'ntp_unavailable' }),
    );
  });
});
