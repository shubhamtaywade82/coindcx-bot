import type { StrategyTrigger } from '../strategy/types';

export interface AiTriggerGateOptions {
  clock?: () => number;
  llmPulseMinIntervalMs: number;
  aiConductorMinIntervalMs: number;
  startupPulseEnabled: boolean;
}

export class AiTriggerGate {
  private readonly clock: () => number;
  private readonly lastLlmPulseAt = new Map<string, number>();
  private readonly lastAiConductorAt = new Map<string, number>();

  constructor(private readonly opts: AiTriggerGateOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  allowStartupPulse(): boolean {
    return this.opts.startupPulseEnabled;
  }

  allowLlmPulse(pair: string, _trigger: StrategyTrigger): boolean {
    return this.allow(this.lastLlmPulseAt, pair, this.opts.llmPulseMinIntervalMs);
  }

  allowAiConductor(pair: string): boolean {
    return this.allow(this.lastAiConductorAt, pair, this.opts.aiConductorMinIntervalMs);
  }

  private allow(store: Map<string, number>, pair: string, minIntervalMs: number): boolean {
    const now = this.clock();
    const last = store.get(pair);
    if (last !== undefined && now - last < minIntervalMs) return false;
    store.set(pair, now);
    return true;
  }
}
