import type { ApprovedTradeIntent } from '../execution/intent-validator';

export type OrderRoute = 'paper' | 'blocked';

export interface RoutedOrder {
  route: OrderRoute;
  pair: string;
  side: ApprovedTradeIntent['side'];
  intentId: string;
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
