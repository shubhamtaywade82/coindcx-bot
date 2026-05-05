import { describe, it, expect } from 'vitest';
import {
  classifyPortfolioRisk,
  inrBalanceRowUnrealizedPnl,
  marginPnlBuckets,
  mergeBalanceRowsForDisplay,
  portfolioUnrealizedInrUsdt,
  pnlPctVsWallet,
  quoteBucketForPosition,
  sumRealizedPnlUsdt,
  unrealizedPnlNumber,
  utilPctVsWallet,
  walletTotal,
} from '../../src/tui/balance-display';
import type { Balance, Position } from '../../src/account/types';

describe('balance-display', () => {
  it('walletTotal sums available and locked', () => {
    const b: Balance = {
      currency: 'USDT',
      available: '1',
      locked: '0.5',
      updatedAt: 't',
      source: 'rest',
    };
    expect(walletTotal(b)).toBe(1.5);
  });

  it('mergeBalanceRowsForDisplay prefers the row with larger total wallet', () => {
    const map = new Map<string, { balance: string; locked: string }>();
    map.set('USDT', { balance: '10', locked: '2' });
    const snap: Balance[] = [
      { currency: 'USDT', available: '0', locked: '0', updatedAt: 't', source: 'ws' },
    ];
    const merged = mergeBalanceRowsForDisplay(map, snap, 'now');
    expect(merged).toHaveLength(1);
    expect(walletTotal(merged[0])).toBe(12);
  });

  it('mergeBalanceRowsForDisplay prefers snapshot when it has the larger wallet', () => {
    const map = new Map<string, { balance: string; locked: string }>();
    map.set('USDT', { balance: '0', locked: '0' });
    const snap: Balance[] = [
      { currency: 'USDT', available: '5', locked: '1', updatedAt: 't', source: 'rest' },
    ];
    const merged = mergeBalanceRowsForDisplay(map, snap, 'now');
    expect(walletTotal(merged[0])).toBe(6);
  });

  it('marginPnlBuckets splits unrealized by pair quote (USDT vs INR), not margin_currency', () => {
    const positions: Position[] = [
      {
        id: '1',
        pair: 'B-BTC_USDT',
        side: 'long',
        activePos: '1',
        avgPrice: '100',
        markPrice: '90',
        marginCurrency: 'INR',
        unrealizedPnl: '-10',
        realizedPnl: '0',
        updatedAt: 't',
        source: 'ws',
      },
      {
        id: '2',
        pair: 'B-ETH_INR',
        side: 'long',
        activePos: '2',
        avgPrice: '200',
        markPrice: '190',
        marginCurrency: 'USDT',
        unrealizedPnl: '-20',
        realizedPnl: '0',
        updatedAt: 't',
        source: 'ws',
      },
    ];
    const tickers = new Map<string, { price: string }>();
    tickers.set('BTCUSDT', { price: '110' });
    tickers.set('ETHINR', { price: '210' });
    const b = marginPnlBuckets(positions, tickers);
    expect(b.pnlUsdtMargin).toBeCloseTo(10, 5);
    expect(b.pnlInrMargin).toBeCloseTo(20, 5);
  });

  it('quoteBucketForPosition treats B-prefixed USDT instruments as USDT quote', () => {
    expect(quoteBucketForPosition('B-SOL_USDT')).toBe('USDT');
    expect(quoteBucketForPosition('SOL_USDT')).toBe('USDT');
    expect(quoteBucketForPosition('B-ETH_INR')).toBe('INR');
  });

  it('unrealizedPnlNumber uses live ticker when present', () => {
    const p: Position = {
      id: '1',
      pair: 'B-BTC_USDT',
      side: 'long',
      activePos: '1',
      avgPrice: '100',
      unrealizedPnl: '0',
      realizedPnl: '0',
      updatedAt: 't',
      source: 'ws',
      marginCurrency: 'USDT',
    };
    const tickers = new Map([['BTCUSDT', { price: '105' }]]);
    expect(unrealizedPnlNumber(p, tickers)).toBe(5);
  });

  it('portfolioUnrealizedInrUsdt converts buckets to strip totals', () => {
    const r = portfolioUnrealizedInrUsdt({ pnlInrMargin: -100, pnlUsdtMargin: -2 }, 90);
    expect(r.totalPnlInr).toBeCloseTo(-100 - 180, 5);
    expect(r.totalPnlUsdt).toBeCloseTo(-2 - 100 / 90, 5);
  });

  it('inrBalanceRowUnrealizedPnl uses INR-quote bucket when set, else portfolio INR', () => {
    expect(inrBalanceRowUnrealizedPnl({ pnlInrMargin: -50, pnlUsdtMargin: -1 }, -140)).toBe(-50);
    const buckets = { pnlInrMargin: 0, pnlUsdtMargin: -2.85 };
    const { totalPnlInr } = portfolioUnrealizedInrUsdt(buckets, 96);
    expect(inrBalanceRowUnrealizedPnl(buckets, totalPnlInr)).toBeCloseTo(-2.85 * 96, 5);
  });

  it('pnlPctVsWallet returns null when wallet is ~zero', () => {
    expect(pnlPctVsWallet(-50, 0)).toBeNull();
    expect(utilPctVsWallet(1, 0)).toBeNull();
  });

  it('sumRealizedPnlUsdt sums USDT-quote positions only', () => {
    const positions = [
      {
        id: '1',
        pair: 'B-BTC_USDT',
        side: 'long' as const,
        activePos: '1',
        avgPrice: '1',
        marginCurrency: 'USDT',
        unrealizedPnl: '0',
        realizedPnl: '2.5',
        updatedAt: 't',
        source: 'ws' as const,
      },
      {
        id: '2',
        pair: 'B-ETH_INR',
        side: 'long' as const,
        activePos: '1',
        avgPrice: '1',
        marginCurrency: 'INR',
        unrealizedPnl: '0',
        realizedPnl: '99',
        updatedAt: 't',
        source: 'ws' as const,
      },
    ];
    expect(sumRealizedPnlUsdt(positions)).toBeCloseTo(2.5, 5);
  });

  it('classifyPortfolioRisk uses drawdown and margin ratio', () => {
    expect(classifyPortfolioRisk(-13, null)).toBe('HIGH');
    expect(classifyPortfolioRisk(-6, null)).toBe('WARN');
    expect(classifyPortfolioRisk(-1, null)).toBe('SAFE');
    expect(classifyPortfolioRisk(0, 0.9)).toBe('HIGH');
    expect(classifyPortfolioRisk(0, 0.55)).toBe('WARN');
  });
});
