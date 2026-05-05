import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { WsSidecar } from '../../src/sidecar/ws-sidecar';

class FakeWs extends EventEmitter {
  connected = false;
  connect = vi.fn(() => {
    this.connected = true;
  });
  reconnect = vi.fn(() => {
    this.connected = true;
  });
}

describe('ws sidecar', () => {
  it('normalizes and publishes mapped events', async () => {
    const ws = new FakeWs();
    const publish = vi.fn().mockResolvedValue('1-0');
    const sidecar = new WsSidecar({
      ws,
      publisher: { publish },
    });
    sidecar.start();

    ws.emit('futures-orderbook-update', { s: 'B-BTC_USDT', bids: [] });
    ws.emit('futures-balance-update', { currency: 'USDT' });

    await Promise.resolve();
    await Promise.resolve();

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stream: 'market.orderbook.update',
        pair: 'BTCUSDT',
      }),
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stream: 'account.balance',
      }),
    );
  });

  it('reconnects websocket on disconnect', () => {
    const ws = new FakeWs();
    const publish = vi.fn().mockResolvedValue('1-0');
    const sidecar = new WsSidecar({
      ws,
      publisher: { publish },
    });
    sidecar.start();

    ws.emit('disconnected', 'network');
    expect(ws.reconnect).toHaveBeenCalledTimes(1);
  });
});
