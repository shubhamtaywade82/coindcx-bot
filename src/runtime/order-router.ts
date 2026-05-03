import type { ApprovedTradeIntent } from '../execution/intent-validator';

export type OrderRoute = 'paper' | 'blocked';

export interface RoutedOrder {
  route: OrderRoute;
  pair: string;
  side: ApprovedTradeIntent['side'];
  intentId: string;
  entryType: ApprovedTradeIntent['entryType'];
  entryPrice?: ApprovedTradeIntent['entryPrice'];
  stopLoss: ApprovedTradeIntent['stopLoss'];
  takeProfit: ApprovedTradeIntent['takeProfit'];
  confidence: ApprovedTradeIntent['confidence'];
  strategyId: ApprovedTradeIntent['strategyId'];
  createdAt: ApprovedTradeIntent['createdAt'];
  ttlMs: ApprovedTradeIntent['ttlMs'];
  metadata?: ApprovedTradeIntent['metadata'];
  routedAt: string;
  reason: string;
}

export class OrderRouter {
  private readonly routedOrders: RoutedOrder[] = [];

  constructor(private readonly clock: () => number = Date.now) {}

  route(intent: ApprovedTradeIntent): RoutedOrder {
    const routed: RoutedOrder = {
      route: 'paper',
      pair: intent.pair,
      side: intent.side,
      intentId: intent.id,
      entryType: intent.entryType,
      ...(intent.entryPrice ? { entryPrice: intent.entryPrice } : {}),
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
      confidence: intent.confidence,
      strategyId: intent.strategyId,
      createdAt: intent.createdAt,
      ttlMs: intent.ttlMs,
      ...(intent.metadata ? { metadata: intent.metadata } : {}),
      routedAt: new Date(this.clock()).toISOString(),
      reason: 'runtime skeleton routes approved intents to paper',
    };
    this.routedOrders.push(routed);
    return routed;
  }

  history(): ReadonlyArray<RoutedOrder> {
    return this.routedOrders.slice();
  }
}
