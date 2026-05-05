import { describe, expect, it } from 'vitest';
import { shouldAllowNegativeClose } from '../../src/runtime/negative-close-policy';

describe('negative-close-policy', () => {
  it('allows close when pnl is non-negative', () => {
    const decision = shouldAllowNegativeClose({
      side: 'LONG',
      unrealizedPnl: 1,
      maxConfluenceScore: 50,
      breakevenArmed: false,
      openedAt: '2026-05-03T12:00:00.000Z',
      nowMs: Date.parse('2026-05-03T12:10:00.000Z'),
      timeStopMs: 60_000,
      highConfluenceThreshold: 85,
    });
    expect(decision).toEqual({ allow: true, reason: 'positive_pnl_or_flat' });
  });

  it('blocks negative close for high confluence', () => {
    const decision = shouldAllowNegativeClose({
      side: 'SHORT',
      unrealizedPnl: -10,
      maxConfluenceScore: 90,
      breakevenArmed: false,
      openedAt: '2026-05-03T12:00:00.000Z',
      nowMs: Date.parse('2026-05-03T12:10:00.000Z'),
      timeStopMs: 60_000,
      highConfluenceThreshold: 85,
    });
    expect(decision).toEqual({ allow: false, reason: 'high_confluence_gate' });
  });

  it('blocks negative close when breakeven lock is armed', () => {
    const decision = shouldAllowNegativeClose({
      side: 'LONG',
      unrealizedPnl: -5,
      maxConfluenceScore: 60,
      breakevenArmed: true,
      openedAt: '2026-05-03T12:00:00.000Z',
      nowMs: Date.parse('2026-05-03T12:10:00.000Z'),
      timeStopMs: 60_000,
      highConfluenceThreshold: 85,
    });
    expect(decision).toEqual({ allow: false, reason: 'breakeven_lock' });
  });

  it('allows negative close only after time-stop kill window', () => {
    const before = shouldAllowNegativeClose({
      side: 'LONG',
      unrealizedPnl: -5,
      maxConfluenceScore: 60,
      breakevenArmed: false,
      openedAt: '2026-05-03T12:00:00.000Z',
      nowMs: Date.parse('2026-05-03T12:10:00.000Z'),
      timeStopMs: 3_600_000,
      highConfluenceThreshold: 85,
    });
    expect(before).toEqual({ allow: false, reason: 'time_stop_not_reached' });

    const after = shouldAllowNegativeClose({
      side: 'LONG',
      unrealizedPnl: -5,
      maxConfluenceScore: 60,
      breakevenArmed: false,
      openedAt: '2026-05-03T12:00:00.000Z',
      nowMs: Date.parse('2026-05-03T13:10:00.000Z'),
      timeStopMs: 3_600_000,
      highConfluenceThreshold: 85,
    });
    expect(after).toEqual({ allow: true, reason: 'time_stop_kill' });
  });
});
