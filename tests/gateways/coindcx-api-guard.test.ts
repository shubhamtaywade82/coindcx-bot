import { describe, it, expect } from 'vitest';
import { __httpForTests } from '../../src/gateways/coindcx-api';
import { ReadOnlyViolation } from '../../src/safety/read-only-guard';

describe('CoinDCX api gateway', () => {
  it('rejects POST to non-allowlisted path', async () => {
    await expect(__httpForTests.post('/exchange/v1/orders/create', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('rejects DELETE', async () => {
    await expect(__httpForTests.delete('/whatever')).rejects.toBeInstanceOf(ReadOnlyViolation);
  });
});
