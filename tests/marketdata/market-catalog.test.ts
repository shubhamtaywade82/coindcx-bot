import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketCatalog } from '../../src/marketdata/market-catalog';

function sampleDetails() {
  return [
    {
      pair: 'B-BTC_USDT',
      symbol: 'BTCUSDT',
      ecode: 'B',
      target_currency_precision: 2,
      base_currency_precision: 6,
      min_notional: '5',
      max_leverage: 25,
    },
    {
      pair: 'B-ETH_USDT',
      symbol: 'ETHUSDT',
      ecode: 'B',
      target_currency_precision: 2,
      base_currency_precision: 5,
      min_notional: '5',
      max_leverage: 20,
    },
  ];
}

describe('MarketCatalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts markets and hydrates in-memory lookups', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pair, symbol, ecode')) {
        return {
          rows: [
            {
              pair: 'B-BTC_USDT',
              symbol: 'BTCUSDT',
              ecode: 'B',
              precision_base: 6,
              precision_quote: 2,
              step: null,
              min_notional: '5',
              max_leverage: '25',
              payload: { pair: 'B-BTC_USDT' },
              refreshed_at: '2026-05-03T08:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT now() - max(refreshed_at)')) {
        return { rows: [{ max_age: { milliseconds: 1000 } }] };
      }
      return { rows: [] };
    });
    const pool = { query } as any;
    const bus = { emit: vi.fn(async () => undefined) } as any;
    const logger = { info: vi.fn(), warn: vi.fn() } as any;

    const fetchMarketDetails = vi.fn(async () => sampleDetails());
    const catalog = new MarketCatalog({
      pool,
      logger,
      bus,
      fetchMarketDetails,
      refreshMs: 60_000,
      staleAlertMs: 120_000,
    });

    await catalog.refreshNow('manual');
    const snapshot = catalog.snapshot();

    expect(fetchMarketDetails).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO market_catalog'),
      expect.arrayContaining(['B-BTC_USDT', 'BTCUSDT']),
    );
    expect(snapshot.byPair.get('B-BTC_USDT')?.symbol).toBe('BTCUSDT');
    expect(snapshot.bySymbol.get('BTCUSDT')?.pair).toBe('B-BTC_USDT');
    expect(snapshot.byEcode.get('B')?.[0]?.pair).toBe('B-BTC_USDT');
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('emits stale alert when refresh age exceeds threshold', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pair, symbol, ecode')) {
        return {
          rows: [
            {
              pair: 'B-BTC_USDT',
              symbol: 'BTCUSDT',
              ecode: 'B',
              precision_base: 6,
              precision_quote: 2,
              step: null,
              min_notional: '5',
              max_leverage: '25',
              payload: {},
              refreshed_at: '2026-05-03T08:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT now() - max(refreshed_at)')) {
        return { rows: [{ max_age: { milliseconds: 120_000 } }] };
      }
      return { rows: [] };
    });
    const bus = { emit: vi.fn(async () => undefined) } as any;
    const logger = { info: vi.fn(), warn: vi.fn() } as any;

    const catalog = new MarketCatalog({
      pool: { query } as any,
      logger,
      bus,
      fetchMarketDetails: vi.fn(async () => sampleDetails()),
      staleAlertMs: 60_000,
    });

    await catalog.refreshNow('manual');
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'market.catalog',
        type: 'catalog.stale',
        severity: 'critical',
      }),
    );
  });

  it('does not emit duplicate stale alert while stale state persists', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pair, symbol, ecode')) {
        return {
          rows: [
            {
              pair: 'B-BTC_USDT',
              symbol: 'BTCUSDT',
              ecode: 'B',
              precision_base: 6,
              precision_quote: 2,
              step: null,
              min_notional: '5',
              max_leverage: '25',
              payload: {},
              refreshed_at: '2026-05-03T08:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT now() - max(refreshed_at)')) {
        return { rows: [{ max_age: { milliseconds: 120_000 } }] };
      }
      return { rows: [] };
    });
    const bus = { emit: vi.fn(async () => undefined) } as any;
    const logger = { info: vi.fn(), warn: vi.fn() } as any;
    const fetchMarketDetails = vi.fn(async () => sampleDetails());

    const catalog = new MarketCatalog({
      pool: { query } as any,
      logger,
      bus,
      fetchMarketDetails,
      staleAlertMs: 60_000,
    });

    await catalog.refreshNow('manual');
    await catalog.refreshNow('manual');
    const staleSignals = (bus.emit as any).mock.calls.filter(
      ([signal]: any[]) => signal?.type === 'catalog.stale',
    );
    expect(staleSignals).toHaveLength(1);
  });
});
