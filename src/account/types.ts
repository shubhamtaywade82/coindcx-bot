export type Side = 'long' | 'short' | 'flat';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
export type Source = 'ws' | 'rest' | 'ws_skewed';
export type Entity = 'position' | 'balance' | 'order' | 'fill';

export interface Position {
  id: string;
  pair: string;
  side: Side;
  activePos: string;
  avgPrice: string;
  markPrice?: string;
  liquidationPrice?: string;
  leverage?: string;
  marginCurrency: string;
  unrealizedPnl: string;
  realizedPnl: string;
  openedAt?: string;
  updatedAt: string;
  source: Source;
}

export interface Balance {
  currency: string;
  available: string;
  locked: string;
  updatedAt: string;
  source: Source;
}

export interface Order {
  id: string;
  pair: string;
  side: OrderSide;
  type: string;
  status: OrderStatus;
  price?: string;
  totalQty: string;
  remainingQty: string;
  avgFillPrice?: string;
  positionId?: string;
  createdAt: string;
  updatedAt: string;
  source: Source;
}

export interface Fill {
  id: string;
  orderId?: string;
  positionId?: string;
  pair: string;
  side: OrderSide;
  price: string;
  qty: string;
  fee?: string;
  feeCurrency?: string;
  realizedPnl?: string;
  executedAt: string;
  ingestedAt: string;
  source: Source;
}

export interface AccountTotals {
  equityInr: string;
  walletInr: string;
  unrealizedInr: string;
  realizedDay: string;
  realizedLifetime: string;
}

export interface AccountSnapshot {
  positions: Position[];
  balances: Balance[];
  orders: Order[];
  totals: AccountTotals;
}

export type Lifecycle = 'opened' | 'closed' | 'flipped' | null;

export interface ApplyResult<T> {
  prev: T | null;
  next: T;
  changedFields: string[];
}

export interface PositionApplyResult extends ApplyResult<Position> {
  lifecycle: Lifecycle;
}
