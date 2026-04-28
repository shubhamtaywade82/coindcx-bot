import type { AccountSnapshot } from '../../account/types';
import type { Signal } from '../../signals/types';
import type { SignalBus } from '../../signals/bus';
import type { RiskFilter, StrategyManifest, StrategySignal } from '../types';
import type { RiskRule, RuleDecision } from './rules/types';
import { PerPairCooldownRule } from './rules/cooldown';

export interface LiveSignalRecord {
  strategyId: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  ts: number;
  ttlMs: number;
}

export interface CompositeRiskFilterOptions {
  rules: RiskRule[];
  signalBus?: Pick<SignalBus, 'emit'>;
  emitAlerts: boolean;
  liveTtlDefaultMs: number;
  clock?: () => number;
  pairResolver?: (signal: StrategySignal, manifest: StrategyManifest) => string;
}

export class CompositeRiskFilter implements RiskFilter {
  private liveSignals: LiveSignalRecord[] = [];
  private clock: () => number;

  constructor(private opts: CompositeRiskFilterOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  filter(signal: StrategySignal, manifest: StrategyManifest, account: AccountSnapshot, pair?: string): StrategySignal | null {
    const now = this.clock();
    this.expire(now);
    const finalPair = pair ?? this.opts.pairResolver?.(signal, manifest) ?? manifest.pairs[0] ?? '*';
    const ctx = {
      signal, manifest, pair: finalPair, account,
      liveSignals: this.liveSignals.slice(),
      now,
    };
    const blocks: RuleDecision[] = [];
    for (const rule of this.opts.rules) {
      const d = rule.apply(ctx);
      if (!d.pass) blocks.push(d);
    }
    if (blocks.length > 0) {
      void this.emitBlocked(signal, manifest, finalPair, blocks, now);
      return null;
    }
    if (signal.side !== 'WAIT') {
      this.liveSignals.push({
        strategyId: manifest.id, pair: finalPair, side: signal.side, ts: now,
        ttlMs: signal.ttlMs ?? this.opts.liveTtlDefaultMs,
      });
      for (const rule of this.opts.rules) {
        if (rule instanceof PerPairCooldownRule) {
          rule.recordEmit(manifest.id, finalPair, signal.side, now);
        }
      }
    }
    return signal;
  }

  liveSnapshot(): ReadonlyArray<LiveSignalRecord> {
    return this.liveSignals.slice();
  }

  private expire(now: number): void {
    this.liveSignals = this.liveSignals.filter(s => now - s.ts < s.ttlMs);
  }

  private async emitBlocked(signal: StrategySignal, manifest: StrategyManifest, pair: string, blocks: RuleDecision[], now: number): Promise<void> {
    if (!this.opts.emitAlerts || !this.opts.signalBus) return;
    const out: Signal = {
      id: `risk.blocked:${manifest.id}:${pair}:${now}`,
      ts: new Date(now).toISOString(),
      strategy: manifest.id,
      type: 'risk.blocked',
      pair,
      severity: 'warn',
      payload: {
        side: signal.side,
        confidence: signal.confidence,
        rules: blocks.map(b => ({ id: b.ruleId, reason: b.reason })),
      },
    };
    await this.opts.signalBus.emit(out);
  }
}
