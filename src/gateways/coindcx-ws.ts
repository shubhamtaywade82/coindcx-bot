import io from 'socket.io-client';
import crypto from 'crypto';
import { config } from '../config/config';
import { EventEmitter } from 'events';
import { assertSocketIoClientVersion } from './socketio-version-guard';

export class CoinDCXWs extends EventEmitter {
  private socket: any;
  private isConnected = false;
  private readonly subscribedPairs = new Set<string>();
  public skipPrivate: boolean = false;

  constructor() {
    super();
    assertSocketIoClientVersion();
  }

  connect() {
    this.socket = io(config.socketBaseUrl, {
      transports: ['websocket'],
      query: { EIO: '3', transport: 'websocket' },
    });

    this.setupSocketListeners();

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.emit('connected');
      this.joinPublicChannels();
      if (config.apiKey && config.apiSecret && !this.skipPrivate) {
        this.joinPrivateChannel();
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      this.isConnected = false;
      this.emit('disconnected', reason);
    });

    this.socket.on('connect_error', (error: any) => {
      this.emit('error', error);
    });
  }

  private joinPublicChannels() {
    config.pairs.forEach((pair) => this.subscribePair(pair));

    this.socket.emit('join', { channelName: 'currentPrices@spot@10s' });
    this.socket.emit('join', { channelName: 'currentPrices@futures@rt' });
  }

  private joinPairChannels(pair: string): void {
    this.emit('debug', `Joining channels for ${pair}`);
    // Spot (no spot orderbook — it shares the same `depth-snapshot` event name as futures and
    // would overwrite the per-pair L2 book with a different microstructure / wrong venue.)
    this.socket.emit('join', { channelName: `${pair}_1m` });
    this.socket.emit('join', { channelName: `${pair}@trades` });
    this.socket.emit('join', { channelName: `${pair}@prices` });
    // Some environments expose priceStats as a separate stream name.
    this.socket.emit('join', { channelName: `${pair}@priceStats` });

    // Futures (L2 + trades + prices for configured instruments)
    this.socket.emit('join', { channelName: `${pair}_1m-futures` });
    this.socket.emit('join', { channelName: `${pair}@orderbook@20-futures` });
    this.socket.emit('join', { channelName: `${pair}@trades-futures` });
    this.socket.emit('join', { channelName: `${pair}@prices-futures` });
  }

  private leavePairChannels(pair: string): void {
    this.emit('debug', `Leaving channels for ${pair}`);
    this.socket.emit('leave', { channelName: `${pair}_1m` });
    this.socket.emit('leave', { channelName: `${pair}@trades` });
    this.socket.emit('leave', { channelName: `${pair}@prices` });
    this.socket.emit('leave', { channelName: `${pair}@priceStats` });
    this.socket.emit('leave', { channelName: `${pair}_1m-futures` });
    this.socket.emit('leave', { channelName: `${pair}@orderbook@20-futures` });
    this.socket.emit('leave', { channelName: `${pair}@trades-futures` });
    this.socket.emit('leave', { channelName: `${pair}@prices-futures` });
  }

  subscribePair(pair: string): void {
    const normalizedPair = pair.trim().toUpperCase();
    if (!normalizedPair || this.subscribedPairs.has(normalizedPair)) {
      return;
    }
    this.subscribedPairs.add(normalizedPair);
    if (this.isConnected) {
      this.joinPairChannels(normalizedPair);
    }
  }

  unsubscribePair(pair: string): void {
    const normalizedPair = pair.trim().toUpperCase();
    if (!normalizedPair || !this.subscribedPairs.has(normalizedPair)) {
      return;
    }
    this.subscribedPairs.delete(normalizedPair);
    if (this.isConnected) {
      this.leavePairChannels(normalizedPair);
    }
  }

  private joinPrivateChannel() {
    const channelName = 'coindcx';
    const body = { channel: channelName };
    const payload = Buffer.from(JSON.stringify(body)).toString();
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

  /**
   * CoinDCX often omits `s` on depth frames (pair is implied by the subscribed channel).
   * Some envelopes include `channel` / `channelName` on the outer object — copy instrument into `s`.
   * Drop spot depth if it ever appears so it cannot overwrite the futures book.
   */
  private normalizePublicEventPayload(event: string, response: any): any {
    const inner = response?.data !== undefined ? response.data : response;
    if (!inner || typeof inner !== 'object') return inner;
    if (event !== 'depth-snapshot' && event !== 'depth-update') return inner;

    const pr = (inner as any).pr;
    if (pr === 'spot' || pr === 's' || pr === 'Spot') return null;

    const out = { ...(inner as Record<string, unknown>) };
    if (!out.s && !out.pair) {
      const ch =
        (typeof response === 'object' && response && (response as any).channel) ||
        (typeof response === 'object' && response && (response as any).channelName) ||
        (out as any).channel;
      if (typeof ch === 'string') {
        const m = ch.match(/^(B-[A-Za-z0-9]+_USDT)@orderbook/);
        if (m) (out as any).s = m[1];
      }
    }
    return out;
  }

  private setupSocketListeners() {
    // ── Public Events ──
    const publicEvents = [
      'candlestick',
      'depth-snapshot',
      'depth-update',
      'new-trade',
      'price-change',
      'priceStats',
      'currentPrices',
      'currentPrices@spot#update',
      'currentPrices@futures#update',
    ];

    publicEvents.forEach((event) => {
      this.socket.on(event, (response: any) => {
        const data = this.normalizePublicEventPayload(event, response);
        if (data === null) return;
        this.emit(event, data);
        if (event === 'currentPrices@spot#update' || event === 'currentPrices@futures#update') {
          this.emit('currentPrices', data);
        }
        if (event === 'price-change') {
          this.emit('priceStats', data);
        }
        if (!['depth-update', 'depth-snapshot'].includes(event)) {
          this.emit('debug', `${event}: ${JSON.stringify(data).substring(0, 100)}`);
        }
      });
    });

    // ── Private Events (`coindcx` may emit either base or df- prefixed names) ──
    const privateEventAliases: Record<string, readonly string[]> = {
      'balance-update': ['balance-update'],
      'position-update': ['position-update', 'df-position-update'],
      'df-position-update': ['df-position-update'],
      'order-update': ['order-update', 'df-order-update'],
      'df-order-update': ['df-order-update', 'order-update'],
      'trade-update': ['trade-update', 'df-trade-update'],
      'df-trade-update': ['df-trade-update', 'trade-update'],
    };

    Object.keys(privateEventAliases).forEach((event) => {
      this.socket.on(event, (response: any) => {
        const data = response.data || response;
        this.emit('debug', `PRIVATE ${event}: ${JSON.stringify(data).substring(0, 100)}`);
        for (const alias of privateEventAliases[event] ?? [event]) {
          this.emit(alias, data);
        }
      });
    });
  }
}
