import type { EventEmitter } from 'events';
import type { Pool } from 'pg';
import type { SignalBus } from '../signals/bus';
import type { Signal, Severity } from '../signals/types';
import type { Candle, MarketState } from '../ai/state-builder';
import type { AccountSnapshot, Fill } from '../account/types';
import { StrategyRegistry } from './registry';
import { ContextBuilder, type CandleProvider } from './context-builder';
import { PassthroughRiskFilter } from './risk/risk-filter';
import { IntervalDriver } from './scheduler/interval-driver';
import { TickDriver } from './scheduler/tick-driver';
import { BarDriver } from './scheduler/bar-driver';
import type { RiskFilter, Strategy, StrategyManifest, StrategySignal, StrategyTrigger, Side } from './types';

const VALID_SIDES: ReadonlySet<Side> = new Set<Side>(['LONG', 'SHORT', 'WAIT']);

interface ControllerConfig {
  timeoutMs: number;
  errorThreshold: number;
  emitWait: boolean;
  backpressureDropRatioAlarm: number;
}

export interface StrategyControllerOptions {
  ws: EventEmitter;
  signalBus: Pick<SignalBus, 'emit'>;
  riskFilter?: RiskFilter;
  buildMarketState: (htf: Candle[], ltf: Candle[]) => MarketState | null;
  candleProvider: CandleProvider;
  accountSnapshot: () => AccountSnapshot;
  recentFills: (n?: number) => Fill[];
  extractPair: (raw: unknown) => string | undefined;
  beforeEvaluate?: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void> | void;
  onEvaluatedSignal?: (signal: StrategySignal, manifest: StrategyManifest, pair: string) => void;
  config: ControllerConfig;
  clock?: () => number;
  pool?: Pool;
}

export class StrategyController {
  readonly registry = new StrategyRegistry();
  private contextBuilder: ContextBuilder;
  private riskFilter: RiskFilter;
  private intervalDriver: IntervalDriver;
  private tickDriver: TickDriver;
  private barDriver: BarDriver;
  private clock: () => number;

  constructor(private opts: StrategyControllerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.riskFilter = opts.riskFilter ?? new PassthroughRiskFilter();
    this.contextBuilder = new ContextBuilder({
      buildMarketState: opts.buildMarketState,
      candleProvider: opts.candleProvider,
      accountSnapshot: opts.accountSnapshot,
      recentFills: opts.recentFills,
      clock: this.clock,
    });
    const runner = (id: string, pair: string, trigger: StrategyTrigger) => this.runOnce(id, pair, trigger);
    this.intervalDriver = new IntervalDriver({ runEvaluation: runner });
    this.tickDriver = new TickDriver({ ws: opts.ws, runEvaluation: runner, extractPair: opts.extractPair });
    this.barDriver = new BarDriver({ runEvaluation: runner });
  }

  register(s: Strategy): void {
    this.registry.register(s);
    const m = s.manifest;
    const pairs = m.pairs.includes('*') ? this.expandStarPairs(m) : m.pairs;
    if (m.mode === 'interval') {
      this.intervalDriver.add({ id: m.id, pairs, intervalMs: m.intervalMs ?? 15000 });
    } else if (m.mode === 'tick') {
      this.tickDriver.add({ id: m.id, pairs, channels: m.tickChannels ?? ['new-trade'] });
    } else if (m.mode === 'bar_close') {
      this.barDriver.add({ id: m.id, pairs, timeframes: m.barTimeframes ?? ['1m'] });
    }
  }

  start(): void {
    this.intervalDriver.start();
    this.tickDriver.start();
  }

  stop(): void {
    this.intervalDriver.stop();
    this.tickDriver.stop();
  }

  notifyTrade(pair: string, ts: number): void {
    this.barDriver.tradeAt(pair, ts);
  }

  async runOnce(id: string, pair: string, trigger: StrategyTrigger): Promise<void> {
    if (!this.registry.enabled(id)) return;
    const strat = this.registry.instance(id, pair);
    const manifest = this.registry.manifest(id);
    if (!strat || !manifest) return;
    let raw: StrategySignal | null;
    let evalCtx: ReturnType<ContextBuilder['build']>;
    try {
      await this.opts.beforeEvaluate?.(id, pair, trigger);
      evalCtx = this.contextBuilder.build({ pair, trigger });
      if (!evalCtx) return;
      raw = await this.withTimeout(Promise.resolve(strat.evaluate(evalCtx)));
    } catch (err) {
      await this.handleError(id, pair, err as Error);
      return;
    }
    if (!raw) {
      this.registry.resetErrorStreak(id, pair);
      return;
    }
    if (!VALID_SIDES.has(raw.side as Side)) {
      await this.handleError(id, pair, new Error(`invalid side: ${raw.side}`));
      return;
    }
    raw.confidence = Math.max(0, Math.min(1, Number(raw.confidence)));
    if (Number.isNaN(raw.confidence)) {
      await this.handleError(id, pair, new Error('confidence NaN'));
      return;
    }
    this.registry.resetErrorStreak(id, pair);
    this.opts.onEvaluatedSignal?.(raw, manifest, pair);
    const filtered = this.riskFilter.filter(raw, manifest, evalCtx.account, pair);
    if (!filtered) return;
    if (filtered.side === 'WAIT' && !this.opts.config.emitWait) return;
    await this.emit(filtered, manifest, pair);
  }

  private async emit(signal: StrategySignal, manifest: StrategyManifest, pair: string): Promise<void> {
    const ts = this.clock();
    const severity: Severity = signal.side === 'WAIT' ? 'info' : (signal.confidence > 0.7 ? 'critical' : 'warn');
    const out: Signal = {
      id: `${manifest.id}:${pair}:${ts}`,
      ts: new Date(ts).toISOString(),
      strategy: manifest.id,
      type: `strategy.${signal.side.toLowerCase()}`,
      pair,
      severity,
      payload: {
        confidence: signal.confidence, entry: signal.entry, stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit, reason: signal.reason,
        noTradeCondition: signal.noTradeCondition, ttlMs: signal.ttlMs,
        manifestVersion: manifest.version, meta: signal.meta,
      },
    };
    await this.opts.signalBus.emit(out);
    this.registry.recordEmit(manifest.id);
  }

  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('strategy timeout')), this.opts.config.timeoutMs)),
    ]);
  }

  private async handleError(id: string, pair: string, err: Error): Promise<void> {
    const streak = this.registry.recordError(id, pair);
    const ts = this.clock();
    await this.opts.signalBus.emit({
      id: `${id}:strategy.error:${ts}`,
      ts: new Date(ts).toISOString(),
      strategy: id, type: 'strategy.error', pair, severity: 'warn',
      payload: { error: err.message, streak },
    });
    if (streak >= this.opts.config.errorThreshold) {
      this.registry.disable(id);
      await this.opts.signalBus.emit({
        id: `${id}:strategy.disabled:${ts}`,
        ts: new Date(ts).toISOString(),
        strategy: id, type: 'strategy.disabled', pair, severity: 'critical',
        payload: { reason: `${streak} consecutive errors` },
      });
    }
  }

  private expandStarPairs(_m: StrategyManifest): string[] {
    return [];
  }
}
