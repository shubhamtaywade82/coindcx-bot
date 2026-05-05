import type { TradeIntent } from '../../execution/trade-intent';
import { tradeIntentFromSignal } from '../../execution/trade-intent';
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
  riskPerUnit: number;
  breakevenLockPrice: number;
  reachedBreakevenLockAt?: number;
  openedAt: number;
  ttlMs?: number;
  reason: string;
}

export interface ClosedTrade extends OpenPosition {
  closedAt: number;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;
  rMultiple: number;
  reachedBreakevenLock: boolean;
  timeToOneRMs?: number;
  closedInNegativePnl: boolean;
}

export class Simulator {
  private clock = 0;
  private position: OpenPosition | null = null;
  private pending: TradeIntent | null = null;
  private ledger: ClosedTrade[] = [];

  constructor(private opts: SimulatorOptions) {}

  advanceClock(ts: number): void {
    if (ts > this.clock) this.clock = ts;
  }

  applySignal(signal: StrategySignal): void {
    const intent = tradeIntentFromSignal({
      strategyId: 'backtest.strategy',
      pair: this.opts.pair,
      signal,
      createdAt: new Date(this.clock || Date.now()).toISOString(),
      metadata: { source: 'simulator.applySignal' },
    });
    if (!intent) return;
    this.applyTradeIntent(intent);
  }

  applyTradeIntent(intent: TradeIntent): void {
    if (this.position) this.close(this.clock, this.position.entry, 'flip');
    this.pending = intent;
  }

  markToMarket(ts: number, price: number): void {
    this.advanceClock(ts);
    if (this.pending && Number.isFinite(price)) {
      const p = this.pending;
      const side = p.side as 'LONG' | 'SHORT';
      const entry = Number(p.entryPrice ?? price);
      const stopLoss = Number(p.stopLoss ?? (side === 'LONG' ? price * 0.99 : price * 1.01));
      const takeProfit = Number(p.takeProfit ?? (side === 'LONG' ? price * 1.02 : price * 0.98));
      const riskPerUnit = Math.abs(entry - stopLoss);
      const breakevenLockPrice = side === 'LONG' ? entry + riskPerUnit : entry - riskPerUnit;
      this.position = {
        side,
        entry,
        stopLoss,
        takeProfit,
        riskPerUnit,
        breakevenLockPrice,
        openedAt: ts,
        ttlMs: p.ttlMs,
        reason: p.reason,
      };
      this.pending = null;
      return;
    }
    if (!this.position) return;
    this.trackBreakevenLockAtTick(ts, price);
    if (this.shouldHitTp(price)) this.close(ts, this.position.takeProfit, 'tp');
    else if (this.shouldHitSl(price)) this.close(ts, this.position.stopLoss, 'sl');
    else if (this.position.ttlMs && ts - this.position.openedAt > this.position.ttlMs) {
      this.close(ts, price, 'ttl');
    }
  }

  markToMarketBar(ts: number, bar: { high: number; low: number }): void {
    this.advanceClock(ts);
    if (this.pending) {
      const midPrice = (bar.high + bar.low) / 2;
      this.markToMarket(ts, midPrice);
    }
    if (!this.position) return;
    this.trackBreakevenLockAtBar(ts, bar);
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
    const rMultiple = this.position.riskPerUnit > 0 ? pnl / this.position.riskPerUnit : 0;
    const reachedBreakevenLock = this.position.reachedBreakevenLockAt !== undefined;
    this.ledger.push({
      ...this.position,
      closedAt: ts,
      exitPrice,
      exitReason: reason,
      pnl,
      rMultiple,
      reachedBreakevenLock,
      ...(this.position.reachedBreakevenLockAt !== undefined
        ? { timeToOneRMs: this.position.reachedBreakevenLockAt - this.position.openedAt }
        : {}),
      closedInNegativePnl: pnl < 0,
    });
    this.position = null;
  }

  private trackBreakevenLockAtTick(ts: number, price: number): void {
    if (!this.position || this.position.reachedBreakevenLockAt !== undefined) return;
    if (this.position.side === 'LONG' && price >= this.position.breakevenLockPrice) {
      this.position.reachedBreakevenLockAt = ts;
      return;
    }
    if (this.position.side === 'SHORT' && price <= this.position.breakevenLockPrice) {
      this.position.reachedBreakevenLockAt = ts;
    }
  }

  private trackBreakevenLockAtBar(ts: number, bar: { high: number; low: number }): void {
    if (!this.position || this.position.reachedBreakevenLockAt !== undefined) return;
    if (this.position.side === 'LONG' && bar.high >= this.position.breakevenLockPrice) {
      this.position.reachedBreakevenLockAt = ts;
      return;
    }
    if (this.position.side === 'SHORT' && bar.low <= this.position.breakevenLockPrice) {
      this.position.reachedBreakevenLockAt = ts;
    }
  }

  openPosition(): OpenPosition | null {
    return this.position;
  }

  tradeLedger(): ClosedTrade[] {
    return this.ledger.slice();
  }
}
