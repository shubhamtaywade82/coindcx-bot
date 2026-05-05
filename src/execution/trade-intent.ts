import type { Side, StrategySignal } from '../strategy/types';

export type TradeSide = Exclude<Side, 'WAIT'>;
export type EntryType = 'market' | 'limit';

export interface TradeIntent {
  id: string;
  strategyId: string;
  pair: string;
  side: TradeSide;
  entryType: EntryType;
  entryPrice?: string;
  stopLoss: string;
  takeProfit: string;
  confidence: number;
  ttlMs: number;
  createdAt: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface BuildTradeIntentArgs {
  strategyId: string;
  pair: string;
  signal: StrategySignal;
  createdAt: string;
  entryType?: EntryType;
  id?: string;
  metadata?: Record<string, unknown>;
}

export function isTradeSide(side: unknown): side is TradeSide {
  return side === 'LONG' || side === 'SHORT';
}

function buildTradeIntentId(args: Pick<BuildTradeIntentArgs, 'strategyId' | 'pair' | 'signal' | 'createdAt'>): string {
  return [
    args.strategyId,
    args.pair,
    args.signal.side,
    Date.parse(args.createdAt) || args.createdAt,
  ].join(':');
}

export function tradeIntentFromSignal(args: BuildTradeIntentArgs): TradeIntent | null {
  if (!isTradeSide(args.signal.side)) return null;

  return {
    id: args.id ?? buildTradeIntentId(args),
    strategyId: args.strategyId,
    pair: args.pair,
    side: args.signal.side,
    entryType: args.entryType ?? 'limit',
    entryPrice: args.signal.entry,
    stopLoss: args.signal.stopLoss ?? '',
    takeProfit: args.signal.takeProfit ?? '',
    confidence: args.signal.confidence,
    ttlMs: args.signal.ttlMs ?? 0,
    createdAt: args.createdAt,
    reason: args.signal.reason,
    metadata: {
      ...(args.signal.meta ?? {}),
      ...(args.metadata ?? {}),
    },
  };
}
