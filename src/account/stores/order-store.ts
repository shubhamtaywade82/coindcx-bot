import type { Order, OrderStatus } from '../types';

const CLOSED_STATUSES = new Set<OrderStatus>(['filled', 'cancelled', 'rejected']);
const RANK: Record<OrderStatus, number> = {
  open: 0, partially_filled: 1, filled: 2, cancelled: 2, rejected: 2,
};

export interface OrderStoreOptions {
  closedTtlMs: number;
  closedMax: number;
  clock?: () => number;
  onRegression?: (info: { id: string; from: OrderStatus; to: OrderStatus }) => void;
}

export class OrderStore {
  private map = new Map<string, Order>();
  private clock: () => number;

  constructor(private opts: OrderStoreOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  applyWs(next: Order): { prev: Order | null; next: Order; changedFields: string[] } {
    const prev = this.map.get(next.id) ?? null;
    if (prev && RANK[prev.status] > RANK[next.status]) {
      this.opts.onRegression?.({ id: next.id, from: prev.status, to: next.status });
    }
    const changed = !prev
      ? ['*']
      : (['status', 'remainingQty', 'avgFillPrice', 'price', 'positionId'] as const)
          .filter(k => prev[k] !== next[k]);
    this.map.set(next.id, next);
    return { prev, next, changedFields: changed };
  }

  replaceFromRest(openRows: Order[]): void {
    for (const [id, o] of Array.from(this.map)) {
      if (!CLOSED_STATUSES.has(o.status)) this.map.delete(id);
    }
    for (const r of openRows) this.map.set(r.id, r);
  }

  linkToPosition(orderId: string, positionId: string): void {
    const o = this.map.get(orderId);
    if (o) this.map.set(orderId, { ...o, positionId });
  }

  get(id: string): Order | undefined {
    return this.map.get(id);
  }

  snapshot(): Order[] {
    return Array.from(this.map.values());
  }

  evictExpired(): string[] {
    const now = this.clock();
    const evicted: string[] = [];
    const closed: Order[] = [];
    for (const [id, o] of this.map) {
      if (CLOSED_STATUSES.has(o.status)) {
        const age = now - new Date(o.updatedAt).getTime();
        if (age > this.opts.closedTtlMs) {
          this.map.delete(id);
          evicted.push(id);
        } else {
          closed.push(o);
        }
      }
    }
    if (closed.length > this.opts.closedMax) {
      closed.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const overflow = closed.slice(0, closed.length - this.opts.closedMax);
      for (const o of overflow) {
        this.map.delete(o.id);
        evicted.push(o.id);
      }
    }
    return evicted;
  }
}
