import { describe, it, expect } from 'vitest';
import { PassthroughRiskFilter } from '../../../src/strategy/risk/risk-filter';
import type { StrategyManifest, StrategySignal } from '../../../src/strategy/types';
import type { AccountSnapshot } from '../../../src/account/types';

const manifest: StrategyManifest = {
  id: 'x', version: '1', mode: 'interval', intervalMs: 1000,
  pairs: ['B-BTC_USDT'], description: 'x',
};
const account: AccountSnapshot = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

describe('PassthroughRiskFilter', () => {
  it('returns input unchanged for LONG', () => {
    const f = new PassthroughRiskFilter();
    const s: StrategySignal = { side: 'LONG', confidence: 0.8, reason: 'r' };
    expect(f.filter(s, manifest, account, 'B-BTC_USDT')).toEqual(s);
  });
  it('returns input unchanged for WAIT', () => {
    const f = new PassthroughRiskFilter();
    const s: StrategySignal = { side: 'WAIT', confidence: 0, reason: 'r' };
    expect(f.filter(s, manifest, account, 'B-BTC_USDT')).toEqual(s);
  });
});
