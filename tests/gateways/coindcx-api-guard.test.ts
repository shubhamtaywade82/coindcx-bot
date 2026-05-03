import { describe, it, expect } from 'vitest';
import { __httpForTests } from '../../src/gateways/coindcx-api';
import { ReadOnlyViolation } from '../../src/safety/read-only-guard';

describe('CoinDCX api gateway', () => {
  it('rejects POST to non-allowlisted path', async () => {
    await expect(__httpForTests.post('/exchange/v1/orders/create', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('rejects spot write order paths', async () => {
    await expect(__httpForTests.post('/exchange/v1/orders/cancel', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/orders/cancel_all', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/orders/cancel_by_ids', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/orders/edit', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('rejects spot wallet transfer paths', async () => {
    await expect(__httpForTests.post('/exchange/v1/wallets/transfer', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/wallets/sub_account_transfer', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('rejects futures write paths', async () => {
    await expect(__httpForTests.post('/exchange/v1/derivatives/futures/orders/create', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/derivatives/futures/orders/cancel', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/derivatives/futures/orders/edit', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/derivatives/futures/orders/cancel_all', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(__httpForTests.post('/exchange/v1/derivatives/futures/positions/exit', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('rejects DELETE', async () => {
    await expect(__httpForTests.delete('/whatever')).rejects.toBeInstanceOf(ReadOnlyViolation);
  });
});
