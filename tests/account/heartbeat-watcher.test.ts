import { describe, it, expect, vi } from 'vitest';
import { HeartbeatWatcher } from '../../src/account/heartbeat-watcher';

describe('HeartbeatWatcher', () => {
  it('emits stale when channel quiet past floor', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 100, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    now += 50;
    w.tick();
    expect(onStale).not.toHaveBeenCalled();
    now += 100;
    w.tick();
    expect(onStale).toHaveBeenCalledWith('position');
  });

  it('touch resets staleness', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 100, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    now += 200;
    w.touch('position');
    w.tick();
    expect(onStale).not.toHaveBeenCalled();
  });

  it('does not emit twice for same stale window', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 100, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    now += 200;
    w.tick();
    w.tick();
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('channels are independent', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 1000, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    w.touch('balance');
    now += 200;
    w.tick();
    expect(onStale).toHaveBeenCalledWith('position');
    expect(onStale).not.toHaveBeenCalledWith('balance');
  });
});
