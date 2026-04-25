import io from 'socket.io-client';
import crypto from 'crypto';
import { config } from '../config/config';
import { EventEmitter } from 'events';

export class CoinDCXWs extends EventEmitter {
  private socket: any;

  constructor() {
    super();
  }

  connect() {
    this.socket = io(config.socketBaseUrl, {
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      this.emit('connected');
      this.joinPublicChannels();
      if (config.apiKey && config.apiSecret) {
        this.joinPrivateChannel();
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      this.emit('disconnected', reason);
    });

    this.socket.on('connect_error', (error: any) => {
      this.emit('error', error);
    });

    this.setupEvents();
  }

  private joinPublicChannels() {
    config.pairs.forEach((pair) => {
      // Candlestick 1m
      this.socket.emit('join', { channelName: `${pair}_1m` });
      // Orderbook depth 20
      this.socket.emit('join', { channelName: `${pair}@orderbook@20` });
      // Trades
      this.socket.emit('join', { channelName: `${pair}@trades` });
      // Price change
      this.socket.emit('join', { channelName: `${pair}@prices` });
    });

    // Global prices
    this.socket.emit('join', { channelName: 'currentPrices@spot@10s' });
  }

  private joinPrivateChannel() {
    const channelName = 'coindcx';
    const body = { channel: channelName };
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = crypto
      .createHmac('sha256', config.apiSecret)
      .update(payload)
      .digest('hex');

    this.socket.emit('join', {
      channelName,
      authSignature: signature,
      apiKey: config.apiKey,
    });
  }

  private setupEvents() {
    const publicEvents = [
      'candlestick',
      'depth-snapshot',
      'depth-update',
      'new-trade',
      'price-change',
      'currentPrices@spot#update',
    ];

    publicEvents.forEach((event) => {
      this.socket.on(event, (response: any) => {
        this.emit(event, response.data || response);
      });
    });

    // Private events
    const privateEvents = ['balance-update', 'order-update', 'trade-update'];
    privateEvents.forEach((event) => {
      this.socket.on(event, (response: any) => {
        this.emit(event, response.data || response);
      });
    });
  }
}
