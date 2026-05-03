import type { Balance, Order, Position } from './types';

export type Severity = 'info' | 'warn' | 'alarm';

export type Diff =
  | { kind: 'missing_in_local'; id: string; restRow: Record<string, unknown>; severity: Severity }
  | { kind: 'missing_in_rest'; id: string; localRow: Record<string, unknown>; severity: Severity }
  | { kind: 'field_mismatch'; id: string; field: string; local: string; rest: string; severity: Severity };

export interface DivergenceConfig {
  pnlAbsAlarm: number;
  pnlPctAlarm: number;
}

const QTY_FIELDS_POSITION = ['activePos'] as const;
const PNL_FIELDS_POSITION = ['unrealizedPnl', 'realizedPnl'] as const;
const COMPARE_POSITION = ['activePos', 'avgPrice', 'markPrice', 'unrealizedPnl', 'realizedPnl', 'leverage'] as const;

const QTY_FIELDS_BALANCE = ['available', 'locked'] as const;
const COMPARE_BALANCE = ['available', 'locked'] as const;

const QTY_FIELDS_ORDER = ['totalQty', 'remainingQty'] as const;
const COMPARE_ORDER = ['status', 'totalQty', 'remainingQty', 'avgFillPrice', 'price'] as const;

export class DivergenceDetector {
  constructor(private cfg: DivergenceConfig) {}

  diffPositions(local: Position[], rest: Position[]): Diff[] {
    return this.diffEntities(local, rest, COMPARE_POSITION as readonly string[], QTY_FIELDS_POSITION as readonly string[], PNL_FIELDS_POSITION as readonly string[]);
  }

  diffBalances(local: Balance[], rest: Balance[]): Diff[] {
    const idLocal = new Map(local.map(b => [b.currency, b]));
    const idRest = new Map(rest.map(b => [b.currency, b]));
    return this.diffMaps(idLocal, idRest, COMPARE_BALANCE as readonly string[], QTY_FIELDS_BALANCE as readonly string[], []);
  }

  diffOrders(local: Order[], rest: Order[]): Diff[] {
    return this.diffEntities(local, rest, COMPARE_ORDER as readonly string[], QTY_FIELDS_ORDER as readonly string[], []);
  }

  private diffEntities<T extends { id: string }>(
    local: T[], rest: T[],
    compareFields: readonly string[], qtyFields: readonly string[], pnlFields: readonly string[],
  ): Diff[] {
    const idLocal = new Map(local.map(x => [x.id, x]));
    const idRest = new Map(rest.map(x => [x.id, x]));
    return this.diffMaps(idLocal, idRest, compareFields, qtyFields, pnlFields);
  }

  private diffMaps<T>(
    idLocal: Map<string, T>, idRest: Map<string, T>,
    compareFields: readonly string[], qtyFields: readonly string[], pnlFields: readonly string[],
  ): Diff[] {
    const diffs: Diff[] = [];
    for (const [id, restRow] of idRest) {
      const localRow = idLocal.get(id);
      if (!localRow) {
        diffs.push({ kind: 'missing_in_local', id, restRow: restRow as Record<string, unknown>, severity: 'warn' });
        continue;
      }
      for (const field of compareFields) {
        const lv = String((localRow as Record<string, unknown>)[field] ?? '');
        const rv = String((restRow as Record<string, unknown>)[field] ?? '');
        if (lv === rv) continue;
        diffs.push({
          kind: 'field_mismatch', id, field, local: lv, rest: rv,
          severity: this.classify(field, lv, rv, qtyFields, pnlFields),
        });
      }
    }
    for (const [id, localRow] of idLocal) {
      if (!idRest.has(id)) {
        diffs.push({ kind: 'missing_in_rest', id, localRow: localRow as Record<string, unknown>, severity: 'warn' });
      }
    }
    return diffs;
  }

  private classify(field: string, local: string, rest: string, qty: readonly string[], pnl: readonly string[]): Severity {
    if (qty.includes(field)) return 'alarm';
    if (pnl.includes(field)) {
      const lv = Number(local);
      const rv = Number(rest);
      const diff = Math.abs(lv - rv);
      if (diff > this.cfg.pnlAbsAlarm) return 'alarm';
      const denom = Math.max(Math.abs(lv), Math.abs(rv), 1);
      if (diff / denom > this.cfg.pnlPctAlarm) return 'alarm';
      return 'warn';
    }
    return 'info';
  }
}
