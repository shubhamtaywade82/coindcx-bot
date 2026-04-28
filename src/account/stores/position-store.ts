import type { Position, PositionApplyResult, Side } from '../types';

const TRACKED_FIELDS: (keyof Position)[] = [
  'pair', 'side', 'activePos', 'avgPrice', 'markPrice', 'liquidationPrice',
  'leverage', 'marginCurrency', 'unrealizedPnl', 'realizedPnl', 'openedAt',
];

function diffFields(prev: Position | null, next: Position): string[] {
  if (!prev) return ['*'];
  const changed: string[] = [];
  for (const k of TRACKED_FIELDS) {
    if (prev[k] !== next[k]) changed.push(k);
  }
  return changed;
}

function classifyLifecycle(prev: Position | null, next: Position): PositionApplyResult['lifecycle'] {
  const prevQty = prev ? Number(prev.activePos) : 0;
  const nextQty = Number(next.activePos);
  if (prevQty === 0 && nextQty !== 0) return 'opened';
  if (prevQty !== 0 && nextQty === 0) return 'closed';
  if (prevQty !== 0 && nextQty !== 0 && Math.sign(prevQty) !== Math.sign(nextQty)) return 'flipped';
  return null;
}

function flatten(p: Position): Position {
  return { ...p, side: 'flat' as Side, activePos: '0' };
}

export class PositionStore {
  private map = new Map<string, Position>();

  applyWs(next: Position): PositionApplyResult {
    const prev = this.map.get(next.id) ?? null;
    const lifecycle = classifyLifecycle(prev, next);
    const changedFields = diffFields(prev, next);
    this.map.set(next.id, next);
    return { prev, next, lifecycle, changedFields };
  }

  replaceFromRest(rows: Position[]): { synthesizedFlat: string[]; applied: Position[] } {
    const restIds = new Set(rows.map(r => r.id));
    const synthesizedFlat: string[] = [];
    for (const [id, existing] of this.map) {
      if (!restIds.has(id) && Number(existing.activePos) !== 0) {
        this.map.set(id, flatten(existing));
        synthesizedFlat.push(id);
      }
    }
    for (const r of rows) this.map.set(r.id, r);
    return { synthesizedFlat, applied: rows };
  }

  snapshot(): Position[] {
    return Array.from(this.map.values()).filter(p => Number(p.activePos) !== 0);
  }

  get(id: string): Position | undefined {
    return this.map.get(id);
  }

  all(): Position[] {
    return Array.from(this.map.values());
  }

  evictFlat(): string[] {
    const evicted: string[] = [];
    for (const [id, p] of this.map) {
      if (p.side === 'flat' && Number(p.activePos) === 0) {
        this.map.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }
}
