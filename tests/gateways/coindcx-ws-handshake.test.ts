import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config/config';

type Handler = (payload?: unknown) => void;

const mockedSocketIo = vi.hoisted(() => {
  class FakeSocket {
    private handlers = new Map<string, Handler[]>();

    readonly emit = vi.fn((_: string, __?: unknown) => undefined);
    readonly on = vi.fn((event: string, handler: Handler) => {
      const existing = this.handlers.get(event) ?? [];
      existing.push(handler);
      this.handlers.set(event, existing);
      return this;
    });

    trigger(event: string, payload?: unknown): void {
      const handlers = this.handlers.get(event) ?? [];
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }

  const state = {
    socket: new FakeSocket(),
    ioMock: vi.fn(() => state.socket),
    FakeSocket,
  };

  return state;
});

vi.mock('socket.io-client', () => ({
  default: mockedSocketIo.ioMock,
}));

import { CoinDCXWs } from '../../src/gateways/coindcx-ws';

describe('CoinDCXWs handshake and event receipt', () => {
  beforeEach(() => {
    mockedSocketIo.socket = new mockedSocketIo.FakeSocket();
    mockedSocketIo.ioMock.mockClear();
  });

  it('connects with required websocket handshake options and joins channels on connect', () => {
    const ws = new CoinDCXWs();
    ws.connect();

    expect(mockedSocketIo.ioMock).toHaveBeenCalledWith(config.socketBaseUrl, {
      transports: ['websocket'],
      query: { EIO: '3', transport: 'websocket' },
    });

    mockedSocketIo.socket.trigger('connect');

    const joinCalls = mockedSocketIo.socket.emit.mock.calls.filter(([event]) => event === 'join');
    const joinedChannels = joinCalls.map(([, payload]) => (payload as { channelName: string }).channelName);

    expect(joinedChannels).toContain('currentPrices@spot@10s');
    expect(joinedChannels).toContain('currentPrices@futures@rt');
    expect(joinedChannels).toContain(`${config.pairs[0]}@orderbook@20-futures`);

    const privateJoin = joinCalls.find(([, payload]) => (payload as { channelName?: string }).channelName === 'coindcx');
    expect(privateJoin).toBeDefined();
    const privatePayload = privateJoin?.[1] as {
      channelName: string;
      apiKey: string;
      authSignature: string;
    };
    expect(privatePayload.apiKey).toBe(config.apiKey);

    const expectedSignature = crypto
      .createHmac('sha256', config.apiSecret)
      .update(Buffer.from(JSON.stringify({ channel: 'coindcx' })).toString())
      .digest('hex');
    expect(privatePayload.authSignature).toBe(expectedSignature);
  });

  it('forwards public and private events and normalizes depth snapshots', () => {
    const ws = new CoinDCXWs();
    ws.connect();

    const candles: unknown[] = [];
    const positions: unknown[] = [];
    const snapshots: Array<Record<string, unknown>> = [];

    ws.on('candlestick', (data) => candles.push(data));
    ws.on('df-position-update', (data) => positions.push(data));
    ws.on('depth-snapshot', (data) => snapshots.push(data as Record<string, unknown>));

    mockedSocketIo.socket.trigger('candlestick', { data: { pair: 'B-BTC_USDT', interval: '1m' } });
    mockedSocketIo.socket.trigger('df-position-update', { data: { id: 'p1', pair: 'B-BTC_USDT' } });
    mockedSocketIo.socket.trigger('depth-snapshot', {
      channel: 'B-BTC_USDT@orderbook@20-futures',
      data: { bids: [['1', '2']], asks: [['3', '4']] },
    });
    mockedSocketIo.socket.trigger('depth-snapshot', { data: { pr: 'spot', bids: [], asks: [] } });

    expect(candles).toEqual([{ pair: 'B-BTC_USDT', interval: '1m' }]);
    expect(positions).toEqual([{ id: 'p1', pair: 'B-BTC_USDT' }]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.s).toBe('B-BTC_USDT');
  });
});
