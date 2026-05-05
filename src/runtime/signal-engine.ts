import type { Signal } from '../signals/types';
import type { Side, StrategySignal } from '../strategy/types';
import type { EntryType, TradeIntent } from '../execution/trade-intent';
import { tradeIntentFromSignal } from '../execution/trade-intent';

export interface SignalEngineInput {
  signal: Signal;
  defaultEntryType?: EntryType;
}

export class SignalEngine {
  isStrategyTradeSignal(signal: Signal): boolean {
    return signal.type === 'strategy.long' || signal.type === 'strategy.short';
  }

  buildTradeIntent(input: SignalEngineInput): TradeIntent | null {
    if (!this.isStrategyTradeSignal(input.signal)) return null;
    if (!input.signal.pair) return null;

    const strategySignal = this.toStrategySignal(input.signal);
    if (!strategySignal) return null;

    return tradeIntentFromSignal({
      strategyId: input.signal.strategy,
      pair: input.signal.pair,
      signal: strategySignal,
      createdAt: input.signal.ts,
      entryType: input.defaultEntryType ?? 'limit',
      metadata: { sourceSignalId: input.signal.id },
    });
  }

  private toStrategySignal(signal: Signal): StrategySignal | null {
    const side = this.toSide(signal.type);
    if (!side) return null;

    const confidence = this.toNumber(signal.payload.confidence, 0);
    const reason = this.toString(signal.payload.reason, 'strategy signal');
    const ttlMs = this.toPositiveNumber(signal.payload.ttlMs);
    const entry = this.toOptionalString(signal.payload.entry);
    const stopLoss = this.toOptionalString(signal.payload.stopLoss);
    const takeProfit = this.toOptionalString(signal.payload.takeProfit);
    const noTradeCondition = this.toOptionalString(signal.payload.noTradeCondition);
    const management = this.toOptionalString(signal.payload.management);
    const meta = this.toRecord(signal.payload.meta);

    return {
      side,
      confidence: Math.max(0, Math.min(1, confidence)),
      reason,
      ...(entry ? { entry } : {}),
      ...(stopLoss ? { stopLoss } : {}),
      ...(takeProfit ? { takeProfit } : {}),
      ...(typeof ttlMs === 'number' ? { ttlMs } : {}),
      ...(noTradeCondition ? { noTradeCondition } : {}),
      ...(management ? { management } : {}),
      ...(meta ? { meta } : {}),
    };
  }

  private toSide(type: string): Side | null {
    switch (type) {
      case 'strategy.long':
        return 'LONG';
      case 'strategy.short':
        return 'SHORT';
      default:
        return null;
    }
  }

  private toNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = this.toNumber(value, Number.NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private toString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  }

  private toOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private toRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }
}
