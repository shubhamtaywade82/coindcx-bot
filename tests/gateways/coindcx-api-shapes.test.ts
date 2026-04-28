import { describe, it, expect, vi } from 'vitest';
import { CoinDCXApi, __httpForTests } from '../../src/gateways/coindcx-api';

describe('CoinDCXApi new endpoints', () => {
  it('getOpenOrders posts to /futures/orders with status=open', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getOpenOrders();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/orders',
      expect.objectContaining({ status: 'open' }),
      expect.any(Object),
    );
    spy.mockRestore();
  });

  it('getFuturesTradeHistory posts to /futures/trade_history with from_timestamp', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getFuturesTradeHistory({ fromTimestamp: 12345 });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/trade_history',
      expect.objectContaining({ from_timestamp: 12345 }),
      expect.any(Object),
    );
    spy.mockRestore();
  });
});
