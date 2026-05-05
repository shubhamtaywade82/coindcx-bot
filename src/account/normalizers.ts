import type { Balance, Fill, Order, OrderSide, OrderStatus, Position, Side, Source } from './types';
import { captureLiquidationPrice, resolveMarkPrice } from '../marketdata/data-gap-policy';

const str = (v: any): string => (v === undefined || v === null ? '' : String(v));

/** CoinDCX often sends ms since epoch as number or digit string; Postgres needs ISO for timestamptz. */
export function parseTimestamptzIso(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000;
    const t = new Date(ms).getTime();
    return Number.isFinite(t) ? new Date(ms).toISOString() : null;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{13,16}$/.test(s)) {
    const ms = Number(s);
    const t = new Date(ms).getTime();
    return Number.isFinite(t) ? new Date(ms).toISOString() : null;
  }
  if (/^\d{10}(\.\d+)?$/.test(s)) {
    const sec = Number(s);
    const t = new Date(sec * 1000).getTime();
    return Number.isFinite(t) ? new Date(sec * 1000).toISOString() : null;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function classifySide(activePos: number): Side {
  if (activePos > 0) return 'long';
  if (activePos < 0) return 'short';
  return 'flat';
}

export function normalizePosition(raw: any, source: Source, now: string): Position {
  const activePos = Number(raw.active_pos ?? 0);
  const previousLiquidationPrice =
    raw.previous_liquidation_price !== undefined ? str(raw.previous_liquidation_price) : undefined;
  const markPrice = resolveMarkPrice({
    markPrice: raw.mark_price,
    lastPrice: raw.last_price,
    avgPrice: raw.avg_price,
  });
  const liquidationPrice = captureLiquidationPrice({
    observedLiquidationPrice: raw.liquidation_price,
    previousLiquidationPrice,
  });
  return {
    id: str(raw.id),
    pair: str(raw.pair),
    side: classifySide(activePos),
    activePos: str(raw.active_pos ?? 0),
    avgPrice: str(raw.avg_price ?? 0),
    markPrice: markPrice !== undefined ? str(markPrice) : undefined,
    liquidationPrice,
    leverage: raw.leverage !== undefined ? str(raw.leverage) : undefined,
    marginCurrency: str(raw.margin_currency_short_name ?? raw.settlement_currency_short_name ?? 'USDT').toUpperCase(),
    unrealizedPnl: str(raw.unrealized_pnl ?? 0),
    realizedPnl: str(raw.realized_pnl ?? 0),
    openedAt: parseTimestamptzIso(raw.opened_at) ?? undefined,
    updatedAt: parseTimestamptzIso(raw.updated_at) ?? now,
    source,
  };
}

function parseWalletAmount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = String(v ?? '')
    .trim()
    .replace(/,/g, '');
  if (!t || t === 'null' || t === 'undefined') return 0;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/** Stable decimal string for wallet amounts (avoids 1e-7 float noise). */
function trimWalletDecimal(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  const s = n.toFixed(12);
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '');
}

/**
 * CoinDCX `GET/POST …/derivatives/futures/wallets` rows include margin breakdown fields.
 * Docs: do not treat `balance` alone as wallet total — use `locked_balance`, `cross_order_margin`,
 * and `cross_user_margin` for margin locked; free wallet cash is derived as `balance − sum(margins)`.
 * WS `balance-update` payloads omit `cross_order_margin` / `cross_user_margin`; those rows keep
 * the simple `available = balance`, `locked = locked_balance` mapping.
 */
export function normalizeBalance(raw: any, source: Source, now: string): Balance {
  const currency = str(raw.currency_short_name ?? raw.currency).toUpperCase();
  // Require both keys so `/users/balances` rows (no cross margin fields) stay on the legacy path.
  const hasFuturesMarginBreakdown =
    raw && typeof raw === 'object' &&
    'cross_user_margin' in raw &&
    'cross_order_margin' in raw;

  if (hasFuturesMarginBreakdown) {
    const lockedIso = parseWalletAmount(raw.locked_balance);
    const crossOrder = parseWalletAmount(raw.cross_order_margin);
    const crossUser = parseWalletAmount(raw.cross_user_margin);
    const lockedTotal = lockedIso + crossOrder + crossUser;
    const gross = parseWalletAmount(raw.balance);
    const availableNum = Math.max(0, gross - lockedTotal);
    return {
      currency,
      available: trimWalletDecimal(availableNum),
      locked: trimWalletDecimal(lockedTotal),
      updatedAt: parseTimestamptzIso(raw.updated_at) ?? now,
      source,
    };
  }

  return {
    currency,
    available: str(raw.balance ?? 0),
    locked: str(raw.locked_balance ?? raw.locked ?? 0),
    updatedAt: parseTimestamptzIso(raw.updated_at) ?? now,
    source,
  };
}

export function normalizeOrder(raw: any, source: Source, now: string = new Date().toISOString()): Order {
  const side = (str(raw.side).toLowerCase() === 'sell' ? 'sell' : 'buy') as OrderSide;
  return {
    id: str(raw.id),
    pair: str(raw.pair),
    side,
    type: str(raw.order_type ?? raw.type ?? 'unknown'),
    status: (str(raw.status).toLowerCase() || 'open') as OrderStatus,
    price: raw.price !== undefined ? str(raw.price) : undefined,
    totalQty: str(raw.total_quantity ?? raw.quantity ?? 0),
    remainingQty: str(raw.remaining_quantity ?? 0),
    avgFillPrice: raw.avg_price !== undefined ? str(raw.avg_price) : undefined,
    positionId: raw.position_id !== undefined ? str(raw.position_id) : undefined,
    createdAt: parseTimestamptzIso(raw.created_at)
      ?? parseTimestamptzIso(raw.updated_at)
      ?? now,
    updatedAt: parseTimestamptzIso(raw.updated_at)
      ?? parseTimestamptzIso(raw.created_at)
      ?? now,
    source,
  };
}

export function normalizeFill(raw: any, source: Source, now: string): Fill {
  const side = (str(raw.side).toLowerCase() === 'sell' ? 'sell' : 'buy') as OrderSide;
  return {
    id: str(raw.id),
    orderId: raw.order_id !== undefined ? str(raw.order_id) : undefined,
    positionId: raw.position_id !== undefined ? str(raw.position_id) : undefined,
    pair: str(raw.pair),
    side,
    price: str(raw.price ?? 0),
    qty: str(raw.quantity ?? raw.qty ?? 0),
    fee: raw.fee !== undefined ? str(raw.fee) : undefined,
    feeCurrency: raw.fee_currency !== undefined ? str(raw.fee_currency) : undefined,
    realizedPnl: raw.realized_pnl !== undefined ? str(raw.realized_pnl) : undefined,
    executedAt: parseTimestamptzIso(raw.executed_at)
      ?? parseTimestamptzIso(raw.timestamp)
      ?? now,
    ingestedAt: now,
    source,
  };
}
