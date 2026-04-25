import io from 'socket.io-client';
import crypto from 'crypto';
import { config } from '../config/config';
import { EventEmitter } from 'events';

export class CoinDCXWs extends EventEmitter {
  private socket: any;
  public skipPrivate: boolean = false;

  constructor() {
    super();
  }

  connect() {
    this.socket = io(config.socketBaseUrl, {
      transports: ['websocket'],
      query: { EIO: '3', transport: 'websocket' },
    });

    this.setupSocketListeners();

    this.socket.on('connect', () => {
      this.emit('connected');
      this.joinPublicChannels();
      if (config.apiKey && config.apiSecret && !this.skipPrivate) {
        this.joinPrivateChannel();
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      this.emit('disconnected', reason);
    });

    this.socket.on('connect_error', (error: any) => {
      this.emit('error', error);
    });
  }

  private joinPublicChannels() {
    config.pairs.forEach((pair) => {
      this.emit('debug', `Joining channels for ${pair}`);
      // Spot Channels
      this.socket.emit('join', { channelName: `${pair}_1m` });
      this.socket.emit('join', { channelName: `${pair}@orderbook@20` });
      this.socket.emit('join', { channelName: `${pair}@trades` });
      this.socket.emit('join', { channelName: `${pair}@prices` });

      // Futures Channels
      this.socket.emit('join', { channelName: `${pair}_1m-futures` });
      this.socket.emit('join', { channelName: `${pair}@orderbook@20-futures` });
      this.socket.emit('join', { channelName: `${pair}@trades-futures` });
      this.socket.emit('join', { channelName: `${pair}@prices-futures` });
    });

    this.socket.emit('join', { channelName: 'currentPrices@spot@10s' });
    this.socket.emit('join', { channelName: 'currentPrices@futures@rt' });
  }

  private joinPrivateChannel() {
    const channelName = 'coindcx';
    const body = { channel: channelName };
    const payload = JSON.stringify(body);
    const signature = crypto
      .createHmac('sha256', config.apiSecret)
      .update(payload)
      .digest('hex');

    this.emit('debug', `Joining private channel: ${channelName}`);
    this.socket.emit('join', {
      channelName,
      authSignature: signature,
      apiKey: config.apiKey,
    });
  }

  private setupSocketListeners() {
    // ── Public Events ──
    const publicEvents = [
      'candlestick',
      'depth-snapshot',
      'depth-update',
      'new-trade',
      'price-change',
      'currentPrices@spot#update',
      'currentPrices@futures#update',
    ];

    publicEvents.forEach((event) => {
      this.socket.on(event, (response: any) => {
        const data = response.data || response;
        this.emit(event, data);
        // Throttled debug — only log non-noisy events in detail
        if (!['depth-update', 'depth-snapshot'].includes(event)) {
          this.emit('debug', `${event}: ${JSON.stringify(data).substring(0, 100)}`);
        }
      });
    });

    // ── Private Events (CoinDCX derivatives use df- prefix) ──
    const privateEvents = [
      'balance-update',
      'df-position-update',
      'df-order-update',
    ];

    privateEvents.forEach((event) => {
      this.socket.on(event, (response: any) => {
        const data = response.data || response;
        this.emit('debug', `PRIVATE ${event}: ${JSON.stringify(data).substring(0, 100)}`);
        this.emit(event, data);
      });
    });
  }
}
