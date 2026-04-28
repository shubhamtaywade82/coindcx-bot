import type { Balance } from '../types';

export class BalanceStore {
  private map = new Map<string, Balance>();
  private violation = false;

  applyWs(next: Balance): { prev: Balance | null; next: Balance; changedFields: string[] } {
    const prev = this.map.get(next.currency) ?? null;
    this.map.set(next.currency, next);
    this.recomputeViolation();
    const changed = !prev ? ['*'] : (['available', 'locked'] as const).filter(k => prev[k] !== next[k]);
    return { prev, next, changedFields: changed };
  }

  replaceFromRest(rows: Balance[]): void {
    this.map.clear();
    for (const r of rows) this.map.set(r.currency, r);
    this.recomputeViolation();
  }

  get(currency: string): Balance | undefined {
    return this.map.get(currency);
  }

  snapshot(): Balance[] {
    return Array.from(this.map.values());
  }

  hasViolation(): boolean {
    return this.violation;
  }

  private recomputeViolation(): void {
    this.violation = false;
    for (const b of this.map.values()) {
      if (Number(b.available) < 0 || Number(b.locked) < 0) {
        this.violation = true;
        return;
      }
    }
  }
}
