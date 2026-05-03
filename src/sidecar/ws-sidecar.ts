import type { EventEmitter } from 'events';
import { normalizeSidecarEvent, type SidecarEnvelope } from './event-normalizer';

export interface SidecarPublisher {
  publish(envelope: SidecarEnvelope): Promise<string>;
}

export interface WsSidecarOptions {
  ws: EventEmitter & {
    connect: () => void;
    reconnect?: () => void;
  };
  publisher: SidecarPublisher;
  logger?: {
    info?: (meta: Record<string, unknown>, msg: string) => void;
    warn?: (meta: Record<string, unknown>, msg: string) => void;
    error?: (meta: Record<string, unknown>, msg: string) => void;
  };
}

const SIDECAR_EVENTS = [
  'candlestick',
  'futures-candlestick',
  'depth-snapshot',
  'futures-orderbook-snapshot',
  'depth-update',
  'futures-orderbook-update',
  'new-trade',
  'futures-new-trade',
  'priceStats',
  'price-change',
  'futures-price-stats',
  'currentPrices',
  'currentPrices@futures#update',
  'futures-current-prices',
  'futures-ltp-update',
  'ltp-update',
  'balance-update',
  'futures-balance-update',
  'position-update',
  'df-position-update',
  'futures-position-update',
  'order-update',
  'df-order-update',
  'futures-order-update',
  'trade-update',
  'df-trade-update',
  'futures-trade-update',
] as const;

export class WsSidecar {
  private started = false;

  constructor(private readonly opts: WsSidecarOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.opts.ws.on('connected', () => {
      this.opts.logger?.info?.({ mod: 'ws-sidecar' }, 'ws sidecar connected');
    });

    this.opts.ws.on('disconnected', (reason: unknown) => {
      this.opts.logger?.warn?.({ mod: 'ws-sidecar', reason: String(reason ?? 'unknown') }, 'ws sidecar disconnected');
      if (this.opts.ws.reconnect) {
        this.opts.ws.reconnect();
      } else {
        this.opts.ws.connect();
      }
    });

    this.opts.ws.on('error', (error: unknown) => {
      this.opts.logger?.error?.(
        { mod: 'ws-sidecar', error: error instanceof Error ? error.message : String(error) },
        'ws sidecar upstream error',
      );
    });

    SIDECAR_EVENTS.forEach((event) => {
      this.opts.ws.on(event, (raw: unknown) => {
        void this.publishEvent(event, raw);
      });
    });

    this.opts.ws.connect();
  }

  private async publishEvent(event: string, raw: unknown): Promise<void> {
    const envelope = normalizeSidecarEvent(event, raw);
    if (!envelope) return;
    try {
      await this.opts.publisher.publish(envelope);
    } catch (error) {
      this.opts.logger?.error?.(
        {
          mod: 'ws-sidecar',
          stream: envelope.stream,
          event: envelope.event,
          pair: envelope.pair,
          error: error instanceof Error ? error.message : String(error),
        },
        'ws sidecar publish failed',
      );
    }
  }
}

