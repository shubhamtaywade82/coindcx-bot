import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketCatalog } from '../../src/marketdata/market-catalog';

type QueryFn = ReturnType<typeof vi.fn>;

function fakePool() {
  const query = vi.fn(async () => ({ rows: [] }));
  return { query } as unknown as { query: QueryFn };
}

function sampleDetails() {
  return [
    {
      pair: 'B-BTC_USDT',
      symbol: 'BTCUSDT',
      ecode: 'B',
      target_currency_short_name: 'USDT',
      base_currency_short_name: 'BTC',
      target_currency_precision: 2,
      base_currency_precision: 6,
      min_quantity: '0.0001',
      min_notional: '5',
      max_leverage: 25,
    },
    {
      pair: 'B-ETH_USDT',
      symbol: 'ETHUSDT',
      ecode: 'B',
      target_currency_short_name: 'USDT',
      base_currency_short_name: 'ETH',
      target_currency_precision: 2,
      base_currency_precision: 5,
      min_quantity: '0.001',
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
    const pool = fakePool();
    const fetchDetails = vi.fn(async () => sampleDetails());
    const alerts: any[] = [];
    const catalog = new MarketCatalog({
      pool: pool as any,
      fetchDetails,
      refreshMs: 60_000,
      staleMs: 120_000,
      onStale: (a) => alerts.push(a),
    });

    await catalog.refreshNow('boot');
    const snapshot = catalog.snapshot();

    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO markets_catalog'),
      expect.arrayContaining(['B-BTC_USDT', 'BTCUSDT']),
    );
    expect(snapshot.pairToSymbol['B-BTC_USDT']).toBe('BTCUSDT');
    expect(snapshot.symbolToPair['ETHUSDT']).toBe('B-ETH_USDT');
    expect(snapshot.pairToEcode['B-ETH_USDT']).toBe('B');
    expect(alerts).toHaveLength(0);
  });

  it('emits stale alert when refresh age exceeds threshold', async () => {
    const pool = fakePool();
    const fetchDetails = vi.fn(async () => sampleDetails());
    const alerts: any[] = [];
    const catalog = new MarketCatalog({
      pool: pool as any,
      fetchDetails,
      refreshMs: 60_000,
      staleMs: 1,
      onStale: (a) => alerts.push(a),
      now: () => 2_000,
    });

    await catalog.refreshNow('boot');
    // Simulate age > staleMs
    (catalog as any).lastRefreshAt = 1_000;
    (catalog as any).checkStaleness('timer');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].ageMs).toBe(1_000);
    expect(alerts[0].staleThresholdMs).toBe(1);
  });

  it('does not emit duplicate stale alert while stale state persists', async () => {
    const pool = fakePool();
    const fetchDetails = vi.fn(async () => sampleDetails());
    const alerts: any[] = [];
    const catalog = new MarketCatalog({
      pool: pool as any,
      fetchDetails,
      refreshMs: 60_000,
      staleMs: 1,
      onStale: (a) => alerts.push(a),
      now: () => 5_000,
    });

    await catalog.refreshNow('boot');
    (catalog as any).lastRefreshAt = 1_000;
    (catalog as any).checkStaleness('timer');
    (catalog as any).checkStaleness('timer');

    expect(alerts).toHaveLength(1);
  });
});
