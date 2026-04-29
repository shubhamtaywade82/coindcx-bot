import type { Strategy, StrategyManifest } from './types';

interface RegistryEntry {
  manifest: StrategyManifest;
  enabled: boolean;
  perInstance: Map<string, Strategy>;
  perf: { signalsEmitted: number; lastSignalAt: number; errors: number };
  errorStreak: Map<string, number>;
}

export class StrategyRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(s: Strategy, pairs?: string[]): void {
    if (this.entries.has(s.manifest.id)) {
      throw new Error(`duplicate strategy id: ${s.manifest.id}`);
    }
    
    const targetPairs = pairs || s.manifest.pairs;
    if (targetPairs.length > 1 && !s.clone) {
      throw new Error(`strategy ${s.manifest.id} declares multi-pair but lacks clone()`);
    }

    const perInstance = new Map<string, Strategy>();
    if (targetPairs.length > 1) {
      for (const pair of targetPairs) {
        perInstance.set(pair, s.clone!());
      }
    } else {
      perInstance.set(targetPairs[0]!, s);
    }

    this.entries.set(s.manifest.id, {
      manifest: s.manifest,
      enabled: true,
      perInstance,
      perf: { signalsEmitted: 0, lastSignalAt: 0, errors: 0 },
      errorStreak: new Map(),
    });
  }

  list(): StrategyManifest[] {
    return Array.from(this.entries.values()).map(e => e.manifest);
  }

  instance(id: string, pair: string): Strategy | undefined {
    return this.entries.get(id)?.perInstance.get(pair);
  }

  pairs(id: string): string[] {
    const e = this.entries.get(id);
    return e ? Array.from(e.perInstance.keys()) : [];
  }

  enable(id: string): void {
    const e = this.entries.get(id);
    if (e) e.enabled = true;
  }

  disable(id: string): void {
    const e = this.entries.get(id);
    if (e) e.enabled = false;
  }

  enabled(id: string): boolean {
    return !!this.entries.get(id)?.enabled;
  }

  recordEmit(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.perf.signalsEmitted++;
    e.perf.lastSignalAt = Date.now();
  }

  recordError(id: string, pair?: string): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    e.perf.errors++;
    if (pair) {
      const streak = (e.errorStreak.get(pair) ?? 0) + 1;
      e.errorStreak.set(pair, streak);
      return streak;
    }
    return 0;
  }

  resetErrorStreak(id: string, pair: string): void {
    this.entries.get(id)?.errorStreak.set(pair, 0);
  }

  performance(id: string): RegistryEntry['perf'] | undefined {
    return this.entries.get(id)?.perf;
  }

  manifest(id: string): StrategyManifest | undefined {
    return this.entries.get(id)?.manifest;
  }
}
