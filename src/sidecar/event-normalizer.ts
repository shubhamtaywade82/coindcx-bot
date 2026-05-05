import { cleanPair } from '../utils/format';

export type SidecarStream = `market.${string}` | `account.${string}`;

export interface SidecarEnvelope {
  stream: SidecarStream;
  pair?: string;
  ts: string;
  source: 'ws';
  event: string;
  payload: Record<string, unknown>;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function inferPair(payload: Record<string, unknown>): string | undefined {
  const raw = payload.pair ?? payload.s ?? payload.market ?? payload.symbol;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return cleanPair(raw.trim().toUpperCase());
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { rows: value };
  return toRecord(value);
}

export function normalizeSidecarEvent(event: string, raw: unknown, nowIso: string = new Date().toISOString()): SidecarEnvelope | null {
  const payload = normalizePayload(raw);

  const marketMap: Record<string, SidecarStream> = {
    candlestick: 'market.candlestick',
    'futures-candlestick': 'market.candlestick',
    'depth-snapshot': 'market.orderbook.snapshot',
    'futures-orderbook-snapshot': 'market.orderbook.snapshot',
    'depth-update': 'market.orderbook.update',
    'futures-orderbook-update': 'market.orderbook.update',
    'new-trade': 'market.trade',
    'futures-new-trade': 'market.trade',
    priceStats: 'market.price_stats',
    'price-change': 'market.price_stats',
    'futures-price-stats': 'market.price_stats',
    currentPrices: 'market.current_prices',
    'currentPrices@futures#update': 'market.current_prices',
    'futures-current-prices': 'market.current_prices',
    'futures-ltp-update': 'market.ltp',
    'ltp-update': 'market.ltp',
  };

  const accountMap: Record<string, SidecarStream> = {
    'balance-update': 'account.balance',
    'futures-balance-update': 'account.balance',
    'position-update': 'account.position',
    'df-position-update': 'account.position',
    'futures-position-update': 'account.position',
    'order-update': 'account.order',
    'df-order-update': 'account.order',
    'futures-order-update': 'account.order',
    'trade-update': 'account.trade',
    'df-trade-update': 'account.trade',
    'futures-trade-update': 'account.trade',
  };

  const stream = marketMap[event] ?? accountMap[event];
  if (!stream) return null;

  return {
    stream,
    pair: inferPair(payload),
    ts: nowIso,
    source: 'ws',
    event,
    payload,
  };
}
