import type { StrategySignal } from '../types';

export interface SimulatorOptions {
  pair: string;
  pessimistic: boolean;
}

export type ExitReason = 'tp' | 'sl' | 'ttl' | 'flip';

export interface OpenPosition {
  side: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  ttlMs?: number;
  reason: string;
}

export interface ClosedTrade extends OpenPosition {
  closedAt: number;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;
}

export class Simulator {
  private clock = 0;
  private position: OpenPosition | null = null;
  private pending: StrategySignal | null = null;
  private ledger: ClosedTrade[] = [];

  constructor(private opts: SimulatorOptions) {}

  advanceClock(ts: number): void {
    if (ts > this.clock) this.clock = ts;
  }

  applySignal(signal: StrategySignal): void {
    if (signal.side === 'WAIT') return;
    if (this.position) {
      this.close(this.clock, this.position.entry, 'flip');
    }
    this.pending = signal;
  }

  markToMarket(ts: number, price: number): void {
    this.advanceClock(ts);
    if (this.pending && Number.isFinite(price)) {
      const p = this.pending;
      this.position = {
        side: p.side as 'LONG' | 'SHORT',
        entry: Number(p.entry ?? price),
        stopLoss: Number(p.stopLoss ?? (p.side === 'LONG' ? price * 0.99 : price * 1.01)),
        takeProfit: Number(p.takeProfit ?? (p.side === 'LONG' ? price * 1.02 : price * 0.98)),
        openedAt: ts,
        ttlMs: p.ttlMs,
        reason: p.reason,
      };
      this.pending = null;
      return;
    }
    if (!this.position) return;
    if (this.shouldHitTp(price)) this.close(ts, this.position.takeProfit, 'tp');
    else if (this.shouldHitSl(price)) this.close(ts, this.position.stopLoss, 'sl');
    else if (this.position.ttlMs && ts - this.position.openedAt > this.position.ttlMs) {
      this.close(ts, price, 'ttl');
    }
  }

  markToMarketBar(ts: number, bar: { high: number; low: number }): void {
    this.advanceClock(ts);
    if (!this.position) return;
    const slHit = this.position.side === 'LONG' ? bar.low <= this.position.stopLoss : bar.high >= this.position.stopLoss;
    const tpHit = this.position.side === 'LONG' ? bar.high >= this.position.takeProfit : bar.low <= this.position.takeProfit;
    if (slHit && tpHit) {
      this.close(ts, this.opts.pessimistic ? this.position.stopLoss : this.position.takeProfit, this.opts.pessimistic ? 'sl' : 'tp');
      return;
    }
    if (slHit) this.close(ts, this.position.stopLoss, 'sl');
    else if (tpHit) this.close(ts, this.position.takeProfit, 'tp');
    else if (this.position.ttlMs && ts - this.position.openedAt > this.position.ttlMs) {
      this.close(ts, (bar.high + bar.low) / 2, 'ttl');
    }
  }

  private shouldHitTp(price: number): boolean {
    if (!this.position) return false;
    return this.position.side === 'LONG' ? price >= this.position.takeProfit : price <= this.position.takeProfit;
  }

  private shouldHitSl(price: number): boolean {
    if (!this.position) return false;
    return this.position.side === 'LONG' ? price <= this.position.stopLoss : price >= this.position.stopLoss;
  }

  private close(ts: number, exitPrice: number, reason: ExitReason): void {
    if (!this.position) return;
    const direction = this.position.side === 'LONG' ? 1 : -1;
    const pnl = (exitPrice - this.position.entry) * direction;
    this.ledger.push({ ...this.position, closedAt: ts, exitPrice, exitReason: reason, pnl });
    this.position = null;
  }

  openPosition(): OpenPosition | null {
    return this.position;
  }

  tradeLedger(): ClosedTrade[] {
    return this.ledger.slice();
  }
}
