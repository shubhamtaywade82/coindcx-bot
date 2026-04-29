import type { MarketState, Candle } from '../ai/state-builder';
import type { AccountSnapshot, Fill } from '../account/types';

export type StrategyMode = 'interval' | 'tick' | 'bar_close';
export type Side = 'LONG' | 'SHORT' | 'WAIT';
export type TickChannel = 'depth-update' | 'new-trade' | 'currentPrices@futures#update';

export interface StrategyManifest {
  id: string;
  version: string;
  mode: StrategyMode;
  intervalMs?: number;
  evaluationTimeoutMs?: number;
  barTimeframes?: string[];
  tickChannels?: TickChannel[];
  pairs: string[];
  warmupCandles?: number;
  description: string;
}

export type StrategyTrigger =
  | { kind: 'interval' }
  | { kind: 'tick'; channel: TickChannel; raw: unknown }
  | { kind: 'bar_close'; tf: string };

export interface StrategyContext {
  ts: number;
  pair: string;
  marketState: MarketState;
  account: AccountSnapshot;
  recentFills: Fill[];
  trigger: StrategyTrigger;
}

export interface StrategySignal {
  side: Side;
  confidence: number;
  entry?: string;
  stopLoss?: string;
  takeProfit?: string;
  reason: string;
  noTradeCondition?: string;
  ttlMs?: number;
  meta?: Record<string, unknown>;
}

export interface Strategy {
  manifest: StrategyManifest;
  warmup?(ctx: { pair: string; candles: Candle[] }): Promise<void> | void;
  evaluate(ctx: StrategyContext): Promise<StrategySignal | null> | StrategySignal | null;
  clone?(): Strategy;
}

export interface RiskFilter {
  filter(signal: StrategySignal, manifest: StrategyManifest, account: AccountSnapshot, pair: string): StrategySignal | null;
}
