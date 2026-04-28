import { describe, it, expect } from 'vitest';
import { LatencyTracker } from '../../../src/marketdata/health/latency';

describe('LatencyTracker', () => {
  it('records and reports percentiles', () => {
    const lt = new LatencyTracker({ reservoirSize: 1024 });
    for (let i = 1; i <= 100; i++) lt.record('depth-update', 'tickAge', i);
    const s = lt.snapshot('depth-update', 'tickAge');
    expect(s.count).toBe(100);
    expect(s.p50).toBeGreaterThanOrEqual(45);
    expect(s.p50).toBeLessThanOrEqual(55);
    expect(s.p99).toBeGreaterThanOrEqual(95);
  });

  it('separates kinds', () => {
    const lt = new LatencyTracker({ reservoirSize: 1024 });
    lt.record('depth-update', 'wsRtt', 10);
    lt.record('depth-update', 'tickAge', 100);
    expect(lt.snapshot('depth-update', 'wsRtt').p50).toBe(10);
    expect(lt.snapshot('depth-update', 'tickAge').p50).toBe(100);
  });

  it('snapshot returns empty for unknown', () => {
    const lt = new LatencyTracker({ reservoirSize: 1024 });
    expect(lt.snapshot('nope', 'wsRtt').count).toBe(0);
  });
});
