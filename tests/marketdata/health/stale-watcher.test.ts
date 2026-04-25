import { describe, it, expect, vi } from 'vitest';
import { StaleWatcher } from '../../../src/marketdata/health/stale-watcher';

describe('StaleWatcher', () => {
  it('does not alarm when within threshold', () => {
    let now = 1000;
    const w = new StaleWatcher({
      floors: { 'depth-update': 1000 },
      reservoirSize: 16,
      onStale: vi.fn(),
      now: () => now,
    });
    w.touch('depth-update', 'P');
    now = 1500;
    w.tick();
    expect((w.snapshot('depth-update', 'P')).stale).toBe(false);
  });

  it('alarms once when exceeding threshold', () => {
    let now = 1000;
    const onStale = vi.fn();
    const w = new StaleWatcher({
      floors: { 'depth-update': 200 },
      reservoirSize: 16,
      onStale,
      now: () => now,
    });
    w.touch('depth-update', 'P');
    now = 5000;
    w.tick();
    w.tick();
    expect(onStale).toHaveBeenCalledOnce();
    w.touch('depth-update', 'P');
    now = 6000;
    w.tick();
    now = 50_000;
    w.tick();
    expect(onStale).toHaveBeenCalledTimes(2);
  });
});
