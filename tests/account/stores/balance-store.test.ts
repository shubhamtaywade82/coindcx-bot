import { describe, it, expect } from 'vitest';
import { BalanceStore } from '../../../src/account/stores/balance-store';
import type { Balance } from '../../../src/account/types';

const usdt: Balance = {
  currency: 'USDT', available: '100', locked: '50',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

describe('BalanceStore', () => {
  it('upserts per currency', () => {
    const s = new BalanceStore();
    s.applyWs(usdt);
    expect(s.get('USDT')?.available).toBe('100');
    s.applyWs({ ...usdt, available: '120' });
    expect(s.get('USDT')?.available).toBe('120');
  });

  it('replaceFromRest overwrites all rows', () => {
    const s = new BalanceStore();
    s.applyWs(usdt);
    s.applyWs({ ...usdt, currency: 'INR', available: '5000', locked: '0' });
    s.replaceFromRest([{ ...usdt, available: '999' }]);
    expect(s.get('USDT')?.available).toBe('999');
    expect(s.get('INR')).toBeUndefined();
  });

  it('flags violation when balance is negative', () => {
    const s = new BalanceStore();
    s.applyWs({ ...usdt, available: '-1' });
    expect(s.hasViolation()).toBe(true);
  });

  it('clears violation flag after sweep', () => {
    const s = new BalanceStore();
    s.applyWs({ ...usdt, available: '-1' });
    s.replaceFromRest([usdt]);
    expect(s.hasViolation()).toBe(false);
  });

  it('snapshot returns all balances', () => {
    const s = new BalanceStore();
    s.applyWs(usdt);
    expect(s.snapshot()).toHaveLength(1);
  });
});
