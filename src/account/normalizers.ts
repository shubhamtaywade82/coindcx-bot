import type { Balance, Fill, Order, OrderSide, OrderStatus, Position, Side, Source } from './types';
import { captureLiquidationPrice, resolveMarkPrice } from '../marketdata/data-gap-policy';

const str = (v: any): string => (v === undefined || v === null ? '' : String(v));

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
    openedAt: raw.opened_at ? str(raw.opened_at) : undefined,
    updatedAt: str(raw.updated_at ?? now),
    source,
  };
}

export function normalizeBalance(raw: any, source: Source, now: string): Balance {
  return {
    currency: str(raw.currency_short_name ?? raw.currency).toUpperCase(),
    available: str(raw.balance ?? 0),
    locked: str(raw.locked_balance ?? raw.locked ?? 0),
    updatedAt: str(raw.updated_at ?? now),
    source,
  };
}

export function normalizeOrder(raw: any, source: Source): Order {
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
    createdAt: str(raw.created_at ?? raw.updated_at ?? ''),
    updatedAt: str(raw.updated_at ?? raw.created_at ?? ''),
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
    executedAt: str(raw.executed_at ?? raw.timestamp ?? now),
    ingestedAt: now,
    source,
  };
}
