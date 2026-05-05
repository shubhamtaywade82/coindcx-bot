import type { StrategySignal } from './types';

export interface RecentStrategyEntry {
  strategyId: string;
  side: StrategySignal['side'];
  confidence: number;
  reason: string;
  entry?: string;
  stopLoss?: string;
  takeProfit?: string;
  rr?: number;
  ts: number;
}

/**
 * Per-pair, per-strategy ring of the most recent signal. Used by the AI conductor
 * to fuse deterministic strategy verdicts with LLM judgment without coupling to
 * the SignalBus internals.
 */
export class RecentSignalsStore {
  private byPair = new Map<string, Map<string, RecentStrategyEntry>>();
  constructor(private readonly ttlMs: number = 5 * 60_000) {}

  record(pair: string, strategyId: string, signal: StrategySignal): void {
    if (!pair || !strategyId) return;
    let strat = this.byPair.get(pair);
    if (!strat) {
      strat = new Map();
      this.byPair.set(pair, strat);
    }
    const rr = typeof signal.meta?.rr === 'number' ? (signal.meta.rr as number) : undefined;
    strat.set(strategyId, {
      strategyId,
      side: signal.side,
      confidence: signal.confidence,
      reason: signal.reason,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      rr,
      ts: Date.now(),
    });
  }

  /** Live entries for `pair`, freshest first; expired rows are evicted. */
  list(pair: string): RecentStrategyEntry[] {
    const strat = this.byPair.get(pair);
    if (!strat) return [];
    const cutoff = Date.now() - this.ttlMs;
    const out: RecentStrategyEntry[] = [];
    for (const [id, entry] of strat) {
      if (entry.ts < cutoff) {
        strat.delete(id);
        continue;
      }
      out.push(entry);
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
}
