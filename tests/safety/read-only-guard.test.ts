import { describe, it, expect } from 'vitest';
import axios from 'axios';
import nock from 'nock';
import { applyReadOnlyGuard, ReadOnlyViolation, DENY_PATHS } from '../../src/safety/read-only-guard';

describe('ReadOnlyGuard', () => {
  it('blocks POST', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    await expect(client.post('/exchange/v1/markets', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
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
});
