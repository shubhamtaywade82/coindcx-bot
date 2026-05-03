import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoinDCXApi, __httpForTests, __publicHttpForTests } from '../../src/gateways/coindcx-api';

describe('CoinDCXApi new endpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getOpenOrders posts to /futures/orders with status=open', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getOpenOrders();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/orders',
      expect.objectContaining({ status: 'open' }),
      expect.any(Object),
    );
  });

  it('getFuturesTradeHistory posts to /futures/trade_history with from_timestamp', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getFuturesTradeHistory({ fromTimestamp: 12345 });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/trade_history',
      expect.objectContaining({ from_timestamp: 12345 }),
      expect.any(Object),
    );
  });

  it('getMarkets fetches spot markets list', async () => {
    const spy = vi.spyOn(__publicHttpForTests, 'get').mockResolvedValue({ data: ['BTCUSDT'] });
    const data = await CoinDCXApi.getMarkets();
    expect(spy).toHaveBeenCalledWith('/exchange/v1/markets', undefined);
    expect(data).toEqual(['BTCUSDT']);
  });

  it('getPublicTradeHistory calls public trade_history endpoint', async () => {
    const spy = vi.spyOn(__publicHttpForTests, 'get').mockResolvedValue({ data: [{ id: 't1' }] });
    const data = await CoinDCXApi.getPublicTradeHistory('B-BTC_USDT', 25);
    expect(spy).toHaveBeenCalledWith('/market_data/trade_history', {
      params: { pair: 'B-BTC_USDT', limit: 25 },
    });
    expect(data).toEqual([{ id: 't1' }]);
  });

  it('getPublicOrderbook calls public orderbook endpoint', async () => {
    const spy = vi.spyOn(__publicHttpForTests, 'get').mockResolvedValue({ data: { bids: [], asks: [] } });
    const data = await CoinDCXApi.getPublicOrderBook('B-ETH_USDT');
    expect(spy).toHaveBeenCalledWith('/market_data/orderbook', {
      params: { pair: 'B-ETH_USDT' },
    });
    expect(data).toEqual({ bids: [], asks: [] });
  });

  it('getUserBalances posts to users/balances', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ currency: 'USDT' }] });
    const data = await CoinDCXApi.getUserBalances();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/users/balances',
      expect.objectContaining({ timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ currency: 'USDT' }]);
  });

  it('getUserInfo posts to users/info', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: { user: 'abc' } });
    const data = await CoinDCXApi.getUserInfo();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/users/info',
      expect.objectContaining({ timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual({ user: 'abc' });
  });

  it('getSpotOrderStatus posts to orders/status with id payload', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: { status: 'filled' } });
    const data = await CoinDCXApi.getSpotOrderStatus('cid-1');
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/orders/status',
      expect.objectContaining({ id: 'cid-1' }),
      expect.any(Object),
    );
    expect(data).toEqual({ status: 'filled' });
  });

  it('getSpotOrderStatusMultiple posts to orders/status_multiple', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ status: 'open' }] });
    const data = await CoinDCXApi.getSpotOrderStatusMultiple(['o1', 'o2']);
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/orders/status_multiple',
      expect.objectContaining({ id: ['o1', 'o2'] }),
      expect.any(Object),
    );
    expect(data).toEqual([{ status: 'open' }]);
  });

  it('getSpotActiveOrders posts to orders/active_orders with market', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 'o1' }] });
    const data = await CoinDCXApi.getSpotActiveOrders('BTCUSDT');
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/orders/active_orders',
      expect.objectContaining({ market: 'BTCUSDT' }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 'o1' }]);
  });

  it('getSpotActiveOrdersCount posts to orders/active_orders_count', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: { count: 2 } });
    const data = await CoinDCXApi.getSpotActiveOrdersCount();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/orders/active_orders_count',
      expect.objectContaining({ timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual({ count: 2 });
  });

  it('getSpotTradeHistory posts to orders/trade_history', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 't1' }] });
    const data = await CoinDCXApi.getSpotTradeHistory({ market: 'BTCUSDT', page: 2, limit: 50 });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/orders/trade_history',
      expect.objectContaining({ market: 'BTCUSDT', page: 2, limit: 50, timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 't1' }]);
  });

  it('getMarginOrders posts to margin/fetch_orders', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 'm1' }] });
    const data = await CoinDCXApi.getMarginOrders({ market: 'BTCUSDT' });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/margin/fetch_orders',
      expect.objectContaining({ market: 'BTCUSDT', timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 'm1' }]);
  });

  it('getLendOrders posts to funding/fetch_orders', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 'l1' }] });
    const data = await CoinDCXApi.getFundingOrders();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/funding/fetch_orders',
      expect.objectContaining({ timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 'l1' }]);
  });

  it('getFuturesPositionByIdOrPair posts to futures positions/get', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 'p1' }] });
    const data = await CoinDCXApi.getFuturesPositionByIdOrPair({ pair: 'B-BTC_USDT' });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/positions/get',
      expect.objectContaining({ pair: 'B-BTC_USDT', timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 'p1' }]);
  });

  it('getFuturesTransactions posts to futures transactions endpoint', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 'tx1' }] });
    const data = await CoinDCXApi.getFuturesTransactions({ page: 2, limit: 25 });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/transactions',
      expect.objectContaining({ page: 2, limit: 25, timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 'tx1' }]);
  });

  it('getFuturesCrossMarginDetails posts to futures cross margin details endpoint', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: { cross: 'ok' } });
    const data = await CoinDCXApi.getFuturesCrossMarginDetails();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/cross_margin/details',
      expect.objectContaining({ timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual({ cross: 'ok' });
  });

  it('getFuturesWalletTransactions posts to futures wallet transactions endpoint', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [{ id: 'wtx1' }] });
    const data = await CoinDCXApi.getFuturesWalletTransactions({ page: 3, limit: 40 });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/wallets/transactions',
      expect.objectContaining({ page: 3, limit: 40, timestamp: expect.any(Number) }),
      expect.any(Object),
    );
    expect(data).toEqual([{ id: 'wtx1' }]);
  });

  it('getFuturesCurrencyConversion posts to futures currency conversion endpoint', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: { amount: 100 } });
    const data = await CoinDCXApi.getFuturesCurrencyConversion('usdt', 'inr', 100);
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/currency_conversion',
      expect.objectContaining({
        from_currency: 'USDT',
        to_currency: 'INR',
        amount: 100,
        timestamp: expect.any(Number),
      }),
      expect.any(Object),
    );
    expect(data).toEqual({ amount: 100 });
  });

  it('getFuturesCurrentPrices fetches futures current prices from public endpoint', async () => {
    const spy = vi.spyOn(__publicHttpForTests, 'get').mockResolvedValue({ data: { prices: {} } });
    const data = await CoinDCXApi.getFuturesCurrentPrices();
    expect(spy).toHaveBeenCalledWith('/exchange/v1/derivatives/futures/current_prices', undefined);
    expect(data).toEqual({ prices: {} });
  });

  it('getFuturesPairStats fetches futures pair stats from public endpoint', async () => {
    const spy = vi.spyOn(__publicHttpForTests, 'get').mockResolvedValue({ data: [{ pair: 'B-BTC_USDT' }] });
    const data = await CoinDCXApi.getFuturesPairStats('B-BTC_USDT');
    expect(spy).toHaveBeenCalledWith('/exchange/v1/derivatives/futures/pair_stats', {
      params: { pair: 'B-BTC_USDT' },
    });
    expect(data).toEqual([{ pair: 'B-BTC_USDT' }]);
  });

  it('blocks futures create order write path via ReadOnlyGuard', async () => {
    await expect(CoinDCXApi.createFuturesOrder({ pair: 'B-BTC_USDT' })).rejects.toThrow(
      /Read-only violation/,
    );
  });

  it('blocks futures cancel all write path via ReadOnlyGuard', async () => {
    await expect(CoinDCXApi.cancelAllFuturesOpenOrders('B-BTC_USDT')).rejects.toThrow(
      /Read-only violation/,
    );
  });
});
