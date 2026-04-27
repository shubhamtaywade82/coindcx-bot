import type { SignalBus } from '../signals/bus';
import type { Signal } from '../signals/types';
type ChangelogSeverity = 'info' | 'warn' | 'alarm' | null;
import { PositionStore } from './stores/position-store';
import { BalanceStore } from './stores/balance-store';
import { OrderStore } from './stores/order-store';
import { FillsLedger } from './stores/fills-ledger';
import { DivergenceDetector, type Diff } from './divergence-detector';
import { HeartbeatWatcher } from './heartbeat-watcher';
import { DriftSweeper } from './drift-sweeper';
import type { AccountPersistence } from './persistence';
import { normalizePosition, normalizeBalance, normalizeOrder, normalizeFill } from './normalizers';
import type { AccountSnapshot, Entity, Position, Source } from './types';

export interface ReconcileConfig {
  driftSweepMs: number;
  heartbeatFloors: { position: number; balance: number; order: number; fill: number };
  pnlAlarmPct: number;
  utilAlarmPct: number;
  divergencePnlAbsAlarm: number;
  divergencePnlPctAlarm: number;
  backfillHours: number;
  signalCooldownMs: number;
  stormThreshold: number;
  stormWindowMs: number;
}

export interface RestApiLike {
  getFuturesPositions: () => Promise<any>;
  getBalances: () => Promise<any>;
  getOpenOrders: () => Promise<any>;
  getFuturesTradeHistory: (opts: { fromTimestamp?: number; size?: number }) => Promise<any>;
}

export interface ReconcileControllerOptions {
  restApi: RestApiLike;
  persistence: AccountPersistence;
  signalBus: SignalBus;
  tryAcquireBudget: () => Promise<boolean>;
  config: ReconcileConfig;
  clock?: () => number;
}

const STRATEGY = 'account.reconciler';

export class AccountReconcileController {
  readonly positions = new PositionStore();
  readonly balances = new BalanceStore();
  readonly orders: OrderStore;
  readonly fills = new FillsLedger({ ringSize: 1000 });
  private detector: DivergenceDetector;
  private heartbeat: HeartbeatWatcher;
  private sweeper: DriftSweeper;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cooldownAt = new Map<string, number>();
  private stormTimes: number[] = [];
  private clock: () => number;

  constructor(private opts: ReconcileControllerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.orders = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500, clock: this.clock });
    this.detector = new DivergenceDetector({
      pnlAbsAlarm: opts.config.divergencePnlAbsAlarm,
      pnlPctAlarm: opts.config.divergencePnlPctAlarm,
    });
    this.heartbeat = new HeartbeatWatcher({
      floors: opts.config.heartbeatFloors,
      clock: this.clock,
      onStale: ch => { void this.forcedSweep(ch); },
    });
    this.sweeper = new DriftSweeper({
      intervalMs: opts.config.driftSweepMs,
      onSweep: () => this.driftSweep(),
      tryAcquire: opts.tryAcquireBudget,
    });
  }

  start(): void {
    this.sweeper.start();
    this.heartbeatTimer = setInterval(() => this.heartbeat.tick(), 5000);
  }

  stop(): void {
    this.sweeper.stop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async seed(): Promise<void> {
    await Promise.all([this.sweepPositions(), this.sweepBalances(), this.sweepOrders(), this.sweepFills()]);
  }

  async onWsReconnect(): Promise<void> {
    await this.driftSweep();
  }

  async ingest(entity: Entity, raw: any, source: Source = 'ws'): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    this.heartbeat.touch(entity);
    if (entity === 'position') {
      const p = normalizePosition(raw, source, now);
      const r = this.positions.applyWs(p);
      await this.opts.persistence.upsertPosition(p);
      await this.recordDiff('position', p.id, r.prev, p, r.changedFields, 'ws_apply', null);
      if (r.lifecycle) await this.emitLifecycle(p, r.lifecycle);
      await this.maybeEmitThreshold(p);
      return;
    }
    if (entity === 'balance') {
      const b = normalizeBalance(raw, source, now);
      const r = this.balances.applyWs(b);
      await this.opts.persistence.upsertBalance(b);
      await this.recordDiff('balance', b.currency, r.prev, b, r.changedFields, 'ws_apply', null);
      await this.maybeEmitUtilThreshold();
      return;
    }
    if (entity === 'order') {
      const o = normalizeOrder(raw, source);
      const r = this.orders.applyWs(o);
      await this.opts.persistence.upsertOrder(o);
      await this.recordDiff('order', o.id, r.prev, o, r.changedFields, 'ws_apply', null);
      return;
    }
    if (entity === 'fill') {
      const f = normalizeFill(raw, source, now);
      const linkedPositionId = f.orderId ? this.orders.get(f.orderId)?.positionId : undefined;
      const fLinked = { ...f, positionId: f.positionId ?? linkedPositionId };
      if (this.fills.append(fLinked)) {
        await this.opts.persistence.appendFill(fLinked);
        await this.emit({
          type: 'fill.executed', severity: 'info', pair: fLinked.pair,
          payload: { fill: fLinked },
        });
      }
      return;
    }
  }

  snapshot(): AccountSnapshot {
    return {
      positions: this.positions.snapshot(),
      balances: this.balances.snapshot(),
      orders: this.orders.snapshot(),
      totals: this.computeTotals(),
    };
  }

  async forcedSweep(channel: Entity): Promise<void> {
    if (channel === 'position') await this.sweepPositions();
    else if (channel === 'balance') await this.sweepBalances();
    else if (channel === 'order') await this.sweepOrders();
    else if (channel === 'fill') await this.sweepFills();
  }

  private async driftSweep(): Promise<void> {
    await Promise.all([this.sweepPositions(), this.sweepBalances(), this.sweepOrders(), this.sweepFills()]);
  }

  private async sweepPositions(): Promise<void> {
    try {
      const raw = await this.opts.restApi.getFuturesPositions();
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const now = new Date(this.clock()).toISOString();
      const rest = arr.map((r: any) => normalizePosition(r, 'rest', now));
      const localBefore = this.positions.snapshot();
      const diffs = this.detector.diffPositions(localBefore, rest);
      const result = this.positions.replaceFromRest(rest);
      for (const p of rest) await this.opts.persistence.upsertPosition(p);
      for (const id of result.synthesizedFlat) {
        const flat = this.positions.get(id);
        if (flat) await this.opts.persistence.upsertPosition(flat);
        await this.emit({
          type: 'position.closed', severity: 'warn', pair: flat?.pair,
          payload: { id, synthesized: true },
        });
      }
      await this.handleDiffs('position', diffs);
    } catch (err) {
      await this.emitSweepFailed('position', err as Error);
    }
  }

  private async sweepBalances(): Promise<void> {
    try {
      const raw = await this.opts.restApi.getBalances();
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const now = new Date(this.clock()).toISOString();
      const rest = arr.map((r: any) => normalizeBalance(r, 'rest', now));
      const localBefore = this.balances.snapshot();
      const diffs = this.detector.diffBalances(localBefore, rest);
      this.balances.replaceFromRest(rest);
      for (const b of rest) await this.opts.persistence.upsertBalance(b);
      await this.handleDiffs('balance', diffs);
    } catch (err) {
      await this.emitSweepFailed('balance', err as Error);
    }
  }

  private async sweepOrders(): Promise<void> {
    try {
      const raw = await this.opts.restApi.getOpenOrders();
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const rest = arr.map((r: any) => normalizeOrder(r, 'rest'));
      const localBefore = this.orders.snapshot().filter(o => o.status === 'open' || o.status === 'partially_filled');
      const diffs = this.detector.diffOrders(localBefore, rest);
      this.orders.replaceFromRest(rest);
      for (const o of rest) await this.opts.persistence.upsertOrder(o);
      this.orders.evictExpired();
      await this.handleDiffs('order', diffs);
    } catch (err) {
      await this.emitSweepFailed('order', err as Error);
    }
  }

  private async sweepFills(): Promise<void> {
    try {
      const since = this.fills.cursor()
        ? new Date(this.fills.cursor()).getTime()
        : this.clock() - this.opts.config.backfillHours * 3_600_000;
      const raw = await this.opts.restApi.getFuturesTradeHistory({ fromTimestamp: since, size: 100 });
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const now = new Date(this.clock()).toISOString();
      for (const r of arr) {
        const f = normalizeFill(r, 'rest', now);
        if (this.fills.append(f)) {
          await this.opts.persistence.appendFill(f);
        }
      }
    } catch (err) {
      await this.emitSweepFailed('fill', err as Error);
    }
  }

  private async handleDiffs(entity: Entity, diffs: Diff[]): Promise<void> {
    if (diffs.length === 0) {
      await this.opts.persistence.recordChangelog({
        entity, entityId: '*', field: '*', oldValue: null, newValue: null,
        cause: 'rest_sweep', severity: null,
      });
      return;
    }
    let alarmCount = 0;
    for (const d of diffs) {
      let oldV: string | null = null;
      let newV: string | null = null;
      let id = '*';
      let field = '*';
      if (d.kind === 'field_mismatch') { id = d.id; field = d.field; oldV = d.local; newV = d.rest; }
      else if (d.kind === 'missing_in_local') { id = d.id; field = '*'; newV = JSON.stringify(d.restRow); }
      else { id = d.id; field = '*'; oldV = JSON.stringify(d.localRow); }
      await this.opts.persistence.recordChangelog({
        entity, entityId: id, field,
        oldValue: oldV, newValue: newV,
        cause: 'divergence', severity: d.severity,
      });
      if (d.severity === 'alarm') alarmCount++;
    }
    if (alarmCount > 0 && !this.suppressedByStorm(alarmCount)) {
      await this.emit({
        type: 'reconcile.divergence', severity: 'critical',
        payload: { entity, diffs },
      });
    }
  }

  private suppressedByStorm(alarmCount: number): boolean {
    const now = this.clock();
    this.stormTimes = this.stormTimes.filter(t => now - t < this.opts.config.stormWindowMs);
    for (let i = 0; i < alarmCount; i++) this.stormTimes.push(now);
    if (this.stormTimes.length > this.opts.config.stormThreshold) {
      void this.emit({
        type: 'reconcile.storm', severity: 'critical',
        payload: { count: this.stormTimes.length, windowMs: this.opts.config.stormWindowMs },
      });
      this.stormTimes = [];
      return true;
    }
    return false;
  }

  private async recordDiff(entity: Entity, entityId: string, prev: any, next: any, fields: string[], cause: 'ws_apply' | 'rest_sweep', severity: ChangelogSeverity): Promise<void> {
    if (fields.length === 0) return;
    if (fields.includes('*')) {
      await this.opts.persistence.recordChangelog({ entity, entityId, field: '*', oldValue: null, newValue: JSON.stringify(next), cause, severity });
      return;
    }
    for (const f of fields) {
      await this.opts.persistence.recordChangelog({
        entity, entityId, field: f,
        oldValue: prev ? String((prev as any)[f] ?? '') : null,
        newValue: String((next as any)[f] ?? ''),
        cause, severity,
      });
    }
  }

  private async emitLifecycle(p: Position, lifecycle: 'opened' | 'closed' | 'flipped'): Promise<void> {
    await this.emit({
      type: `position.${lifecycle}`, severity: 'info', pair: p.pair,
      payload: { id: p.id, side: p.side, activePos: p.activePos, realizedPnl: p.realizedPnl },
    });
  }

  private async maybeEmitThreshold(p: Position): Promise<void> {
    const pnl = Number(p.unrealizedPnl);
    const margin = Number(p.avgPrice) * Math.abs(Number(p.activePos));
    if (margin <= 0) return;
    const ratio = pnl / margin;
    if (ratio >= this.opts.config.pnlAlarmPct) return;
    await this.emitThrottled(`position.pnl_threshold:${p.id}`, {
      type: 'position.pnl_threshold', severity: 'warn', pair: p.pair,
      payload: { id: p.id, pnl: p.unrealizedPnl, ratio },
    });
  }

  private async maybeEmitUtilThreshold(): Promise<void> {
    let totalLocked = 0;
    let totalWallet = 0;
    for (const b of this.balances.snapshot()) {
      totalLocked += Number(b.locked);
      totalWallet += Number(b.available) + Number(b.locked);
    }
    if (totalWallet <= 0) return;
    const util = totalLocked / totalWallet;
    if (util < this.opts.config.utilAlarmPct) return;
    await this.emitThrottled(`account.margin_util_high`, {
      type: 'account.margin_util_high', severity: 'warn',
      payload: { util, totalLocked, totalWallet },
    });
  }

  private async emitThrottled(key: string, signal: Omit<Signal, 'id' | 'ts' | 'strategy'>): Promise<void> {
    const now = this.clock();
    const last = this.cooldownAt.get(key) ?? 0;
    if (now - last < this.opts.config.signalCooldownMs) return;
    this.cooldownAt.set(key, now);
    await this.emit(signal);
  }

  private async emit(partial: Omit<Signal, 'id' | 'ts' | 'strategy'>): Promise<void> {
    const signal: Signal = {
      id: `${STRATEGY}:${partial.type}:${this.clock()}`,
      ts: new Date(this.clock()).toISOString(),
      strategy: STRATEGY,
      ...partial,
    };
    await this.opts.signalBus.emit(signal);
  }

  private async emitSweepFailed(entity: Entity, err: Error): Promise<void> {
    await this.emit({
      type: 'reconcile.sweep_failed', severity: 'warn',
      payload: { entity, error: err.message },
    });
  }

  private computeTotals(): AccountSnapshot['totals'] {
    let walletInr = 0;
    let unrealizedInr = 0;
    for (const b of this.balances.snapshot()) {
      const w = Number(b.available) + Number(b.locked);
      if (b.currency === 'INR') walletInr += w;
    }
    for (const p of this.positions.snapshot()) {
      if (p.marginCurrency === 'INR') unrealizedInr += Number(p.unrealizedPnl);
    }
    const equityInr = walletInr + unrealizedInr;
    return {
      equityInr: equityInr.toString(), walletInr: walletInr.toString(),
      unrealizedInr: unrealizedInr.toString(),
      realizedDay: '0', realizedLifetime: '0',
    };
  }
}
