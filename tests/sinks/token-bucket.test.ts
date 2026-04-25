import { describe, it, expect, vi } from 'vitest';
import { TokenBucket } from '../../src/sinks/token-bucket';

describe('TokenBucket', () => {
  it('allows up to capacity immediately', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSec: 0 });
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(bucket.available()).toBe(0);
  });

  it('refills over time', async () => {
    let now = 1_000_000;
    const bucket = new TokenBucket({ capacity: 2, refillPerSec: 2, now: () => now });
    await bucket.take();
    await bucket.take();
    expect(bucket.available()).toBe(0);
    now += 1000;
    expect(bucket.available()).toBe(2);
  });
});
