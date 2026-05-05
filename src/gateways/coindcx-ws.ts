import io from 'socket.io-client';
import crypto from 'crypto';
import { config } from '../config/config';
import { EventEmitter } from 'events';
import { assertSocketIoClientVersion } from './socketio-version-guard';

export class CoinDCXWs extends EventEmitter {
  private socket: any;
  private isConnected = false;
  private readonly subscribedPairs = new Set<string>();
  private readonly joinedGlobalChannels = new Set<string>();
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

  disconnect(): void {
    if (!this.socket) return;
    this.socket.disconnect();
    this.isConnected = false;
  }

  reconnect(): void {
    if (this.socket?.connected) return;
    if (this.socket?.connect) {
      this.socket.connect();
      return;
    }
    this.connect();
  }

  private joinPublicChannels() {
    config.pairs.forEach((pair) => {
      const normalizedPair = pair.trim().toUpperCase();
      if (normalizedPair) this.subscribedPairs.add(normalizedPair);
    });
    this.subscribedPairs.forEach((pair) => this.joinPairChannels(pair));
    this.joinGlobalChannel('currentPrices@spot@10s');
    this.joinGlobalChannel('currentPrices@futures@rt');
  }

  getSubscribedPairs(): string[] {
    return Array.from(this.subscribedPairs.values());
  }

  getGlobalChannels(): string[] {
    return Array.from(this.joinedGlobalChannels.values());
  }

  private joinGlobalChannel(channelName: string): void {
    if (!channelName || this.joinedGlobalChannels.has(channelName)) return;
    this.joinedGlobalChannels.add(channelName);
    this.socket.emit('join', { channelName });
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

  private resolveEnvelopeChannel(response: any, inner: any): string | undefined {
    const channelName =
      (typeof response === 'object' && response && (response as any).channelName) ||
      (typeof response === 'object' && response && (response as any).channel) ||
      (inner && typeof inner === 'object' && (inner as any).channelName) ||
      (inner && typeof inner === 'object' && (inner as any).channel);
    if (typeof channelName !== 'string' || !channelName.trim()) {
      return undefined;
    }
    return channelName;
  }

  private inferProduct(event: string, response: any, inner: any): 'futures' | 'spot' | 'unknown' {
    if (event.includes('@futures')) return 'futures';
    if (event.includes('@spot')) return 'spot';
    const hint = String(
      (inner && typeof inner === 'object' && ((inner as any).pr ?? (inner as any).product ?? (inner as any).pcode)) ??
      '',
    ).toLowerCase();
    if (hint === 'f' || hint === 'futures') return 'futures';
    if (hint === 's' || hint === 'spot') return 'spot';

    const channelName = this.resolveEnvelopeChannel(response, inner);
    if (!channelName) return 'unknown';
    if (channelName.includes('-futures') || channelName.includes('@futures')) return 'futures';
    if (channelName.includes('@spot')) return 'spot';
    return 'unknown';
  }

  private emitFuturesLtpUpdates(inner: any): void {
    const prices = inner?.prices;
    if (!prices || typeof prices !== 'object') return;
    Object.entries(prices as Record<string, unknown>).forEach(([pair, row]) => {
      const rowObj = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      const candidate = rowObj.ls ?? rowObj.ltp ?? rowObj.lp ?? rowObj.last_price ?? row;
      const ltp = typeof candidate === 'number' ? candidate : Number(candidate);
      if (!Number.isFinite(ltp)) return;
      const markCandidate = rowObj.mp ?? rowObj.mark_price;
      const markPrice =
        typeof markCandidate === 'number' ? markCandidate : Number(markCandidate ?? ltp);
      const payload = {
        pair,
        ltp,
        markPrice: Number.isFinite(markPrice) ? markPrice : ltp,
        raw: row,
      };
      this.emit('futures-ltp-update', payload);
      this.emit('ltp-update', payload);
    });
  }

  private emitDerivedPublicAliases(event: string, response: any, inner: any): void {
    const product = this.inferProduct(event, response, inner);
    if (product !== 'futures') return;

    switch (event) {
      case 'candlestick':
        this.emit('futures-candlestick', inner);
        return;
      case 'depth-snapshot':
        this.emit('futures-orderbook-snapshot', inner);
        return;
      case 'depth-update':
        this.emit('futures-orderbook-update', inner);
        return;
      case 'new-trade':
        this.emit('futures-new-trade', inner);
        return;
      case 'price-change':
      case 'priceStats':
        this.emit('futures-price-stats', inner);
        return;
      case 'currentPrices':
      case 'currentPrices@futures#update':
        this.emit('futures-current-prices', inner);
        this.emitFuturesLtpUpdates(inner);
        return;
      case 'ltp-update':
        this.emit('futures-ltp-update', inner);
        return;
      default:
        return;
    }
  }

  private emitDerivedPrivateAliases(event: string, data: any): void {
    switch (event) {
      case 'balance-update':
        this.emit('futures-balance-update', data);
        return;
      case 'position-update':
      case 'df-position-update':
        this.emit('futures-position-update', data);
        return;
      case 'order-update':
      case 'df-order-update':
        this.emit('futures-order-update', data);
        return;
      case 'trade-update':
      case 'df-trade-update':
        this.emit('futures-trade-update', data);
        return;
      default:
        return;
    }
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
      'ltp-update',
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
        this.emitDerivedPublicAliases(event, response, data);
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
        this.emitDerivedPrivateAliases(event, data);
      });
    });
  }
}
