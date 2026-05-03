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
    expect(spy).toHaveBeenCalledWith('/exchange/v1/markets');
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
    const data = await CoinDCXApi.getPublicOrderbook('B-ETH_USDT');
    expect(spy).toHaveBeenCalledWith('/market_data/orderbook', {
      params: { pair: 'B-ETH_USDT' },
    });
    expect(data).toEqual({ bids: [], asks: [] });
  });
});
