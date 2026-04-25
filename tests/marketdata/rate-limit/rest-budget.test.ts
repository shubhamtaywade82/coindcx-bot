import { describe, it, expect } from 'vitest';
import { RestBudget } from '../../../src/marketdata/rate-limit/rest-budget';

describe('RestBudget', () => {
  it('grants global tokens up to capacity', async () => {
    const now = 0;
    const b = new RestBudget({ globalPerMin: 2, pairPerMin: 10, timeoutMs: 100, now: () => now });
    expect(await b.acquire('p1').then(() => true).catch(() => false)).toBe(true);
    expect(await b.acquire('p2').then(() => true).catch(() => false)).toBe(true);
    expect(await b.acquire('p3').then(() => true).catch(() => false)).toBe(false);
  });

  it('grants per-pair tokens up to per-pair capacity', async () => {
    const now = 0;
    const b = new RestBudget({ globalPerMin: 100, pairPerMin: 1, timeoutMs: 100, now: () => now });
    expect(await b.acquire('p1').then(() => true).catch(() => false)).toBe(true);
    expect(await b.acquire('p1').then(() => true).catch(() => false)).toBe(false);
    expect(await b.acquire('p2').then(() => true).catch(() => false)).toBe(true);
  });

  it('refills over time', async () => {
    let now = 0;
    const b = new RestBudget({ globalPerMin: 1, pairPerMin: 10, timeoutMs: 0, now: () => now });
    await b.acquire('p1');
    expect(await b.acquire('p2').then(() => 'yes').catch(() => 'no')).toBe('no');
    now += 60_000;
    expect(await b.acquire('p2').then(() => 'yes').catch(() => 'no')).toBe('yes');
  });
});
