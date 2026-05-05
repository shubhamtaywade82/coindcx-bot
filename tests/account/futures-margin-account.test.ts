import { describe, it, expect } from 'vitest';
import {
  mergeCoinDcxBalanceWsPayload,
  parseCrossMarginDetails,
} from '../../src/account/futures-margin-account';

describe('futures-margin-account', () => {
  it('parseCrossMarginDetails maps CoinDCX cross_margin_details response', () => {
    const raw = {
      pnl: -0.0635144,
      total_wallet_balance: 7.16966176,
      total_account_equity: 7.10614736,
      withdrawable_balance: 6.42080088,
      total_initial_margin: 0.68534648,
      maintenance_margin: 0.10170128,
      margin_ratio_cross: 0.01431173,
    };
    const s = parseCrossMarginDetails(raw);
    expect(s).not.toBeNull();
    expect(s!.marginRatioCross).toBeCloseTo(0.01431173, 8);
    expect(s!.unrealizedPnl).toBeCloseTo(-0.0635144, 8);
    expect(s!.totalWalletBalance).toBeCloseTo(7.16966176, 8);
    expect(s!.totalAccountEquity).toBeCloseTo(7.10614736, 8);
    expect(s!.withdrawableBalance).toBeCloseTo(6.42080088, 8);
    expect(s!.totalInitialMargin).toBeCloseTo(0.68534648, 8);
  });

  it('parseCrossMarginDetails returns null for empty payload', () => {
    expect(parseCrossMarginDetails(null)).toBeNull();
    expect(parseCrossMarginDetails({})).toBeNull();
  });

  it('mergeCoinDcxBalanceWsPayload keeps prior wallet when WS sends zeros', () => {
    const prev = { balance: '10', locked: '2' };
    const m = mergeCoinDcxBalanceWsPayload(prev, '0', '0');
    expect(m.balance).toBe('10');
    expect(m.locked).toBe('2');
  });

  it('mergeCoinDcxBalanceWsPayload applies non-zero WS update', () => {
    const prev = { balance: '10', locked: '2' };
    const m = mergeCoinDcxBalanceWsPayload(prev, '3', '1');
    expect(m.balance).toBe('3');
    expect(m.locked).toBe('1');
  });
});
