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
});
