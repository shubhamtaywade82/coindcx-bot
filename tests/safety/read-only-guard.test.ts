import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import nock from 'nock';
import {
  applyReadOnlyGuard,
  ReadOnlyViolation,
  DENY_PATHS,
  getWriteRateLimitPolicy,
} from '../../src/safety/read-only-guard';

describe('ReadOnlyGuard', () => {
  it('blocks POST to non-allowlisted path', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    await expect(client.post('/exchange/v1/markets', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('allows POST to signed-read allowlisted path', async () => {
    nock('https://api.coindcx.com')
      .post('/exchange/v1/derivatives/futures/positions')
      .reply(200, []);
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    const r = await client.post('/exchange/v1/derivatives/futures/positions', {});
    expect(r.status).toBe(200);
  });

  it('blocks PUT, PATCH, DELETE', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    await expect(client.put('/x', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(client.patch('/x', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(client.delete('/x')).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('blocks denied paths even on GET', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    for (const p of DENY_PATHS) {
      await expect(client.get(p)).rejects.toBeInstanceOf(ReadOnlyViolation);
    }
  });

  it('passes safe GET', async () => {
    nock('https://api.coindcx.com').get('/exchange/v1/markets').reply(200, []);
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    const r = await client.get('/exchange/v1/markets');
    expect(r.status).toBe(200);
  });

  it('invokes onViolation hook with details', async () => {
    let captured: any;
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client, { onViolation: (info) => { captured = info; } });
    await client.post('/x', {}).catch(() => {});
    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/x');
  });

  it('exposes cancel_all rate-limit policy metadata on violation', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    let err: unknown;
    try {
      await client.post('/exchange/v1/orders/cancel_all', { market: 'BTCUSDT' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadOnlyViolation);
    const violation = err as ReadOnlyViolation;
    expect(violation.path).toBe('/exchange/v1/orders/cancel_all');
    expect(violation.rateLimitPolicy).toEqual(
      getWriteRateLimitPolicy('/exchange/v1/orders/cancel_all'),
    );
  });

  it('includes policy metadata in onViolation callback for cancel_all', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    const onViolation = vi.fn();
    applyReadOnlyGuard(client, { onViolation });
    await client.post('/exchange/v1/orders/cancel_all', { market: 'BTCUSDT' }).catch(() => {});
    expect(onViolation).toHaveBeenCalledWith({
      method: 'POST',
      path: '/exchange/v1/orders/cancel_all',
      rateLimitPolicy: getWriteRateLimitPolicy('/exchange/v1/orders/cancel_all'),
    });
  });

  it('allows signed-read futures wallet transactions path', async () => {
    nock('https://api.coindcx.com')
      .post('/exchange/v1/derivatives/futures/wallets/transactions')
      .reply(200, []);
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    const response = await client.post('/exchange/v1/derivatives/futures/wallets/transactions', {});
    expect(response.status).toBe(200);
  });

  it('allows signed-read futures transactions path', async () => {
    nock('https://api.coindcx.com')
      .post('/exchange/v1/derivatives/futures/positions/transactions')
      .reply(200, []);
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    const response = await client.post('/exchange/v1/derivatives/futures/positions/transactions', {});
    expect(response.status).toBe(200);
  });

  it('blocks futures wallet transfer write path', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    await expect(
      client.post('/exchange/v1/derivatives/futures/wallets/transfer', { amount: 10 }),
    ).rejects.toBeInstanceOf(ReadOnlyViolation);
  });
});
