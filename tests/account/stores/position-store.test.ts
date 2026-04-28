import { describe, it, expect } from 'vitest';
import { PositionStore } from '../../../src/account/stores/position-store';
import type { Position } from '../../../src/account/types';

const base: Position = {
  id: 'p1', pair: 'B-BTC_USDT', side: 'long',
  activePos: '0.5', avgPrice: '50000', markPrice: '50100',
  marginCurrency: 'USDT', unrealizedPnl: '50', realizedPnl: '0',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

describe('PositionStore', () => {
  it('upserts on applyWs and reports changedFields', () => {
    const s = new PositionStore();
    const r1 = s.applyWs(base);
    expect(r1.prev).toBeNull();
    expect(r1.next.id).toBe('p1');
    expect(r1.lifecycle).toBe('opened');

    const r2 = s.applyWs({ ...base, markPrice: '51000', unrealizedPnl: '500' });
    expect(r2.prev?.markPrice).toBe('50100');
    expect(r2.next.markPrice).toBe('51000');
    expect(r2.changedFields).toEqual(expect.arrayContaining(['markPrice', 'unrealizedPnl']));
    expect(r2.lifecycle).toBeNull();
  });

  it('emits closed lifecycle when activePos goes to 0', () => {
    const s = new PositionStore();
    s.applyWs(base);
    const r = s.applyWs({ ...base, activePos: '0', side: 'flat' });
    expect(r.lifecycle).toBe('closed');
  });

  it('emits flipped lifecycle when sign changes without zero crossing', () => {
    const s = new PositionStore();
    s.applyWs(base);
    const r = s.applyWs({ ...base, activePos: '-0.3', side: 'short' });
    expect(r.lifecycle).toBe('flipped');
  });

  it('replaceFromRest synthesizes flat for ids missing in REST', () => {
    const s = new PositionStore();
    s.applyWs(base);
    s.applyWs({ ...base, id: 'p2' });
    const restOnlyP1 = [{ ...base, activePos: '0.7', source: 'rest' as const }];
    const result = s.replaceFromRest(restOnlyP1);
    expect(result.synthesizedFlat).toEqual(['p2']);
    expect(s.get('p1')?.activePos).toBe('0.7');
    expect(s.get('p2')?.side).toBe('flat');
    expect(s.get('p2')?.activePos).toBe('0');
  });

  it('snapshot returns only active (activePos != 0)', () => {
    const s = new PositionStore();
    s.applyWs(base);
    s.applyWs({ ...base, id: 'p2', activePos: '0', side: 'flat' });
    expect(s.snapshot().map(p => p.id)).toEqual(['p1']);
  });

  it('idempotent re-apply emits no lifecycle event after first', () => {
    const s = new PositionStore();
    s.applyWs(base);
    const r = s.applyWs(base);
    expect(r.lifecycle).toBeNull();
    expect(r.changedFields).toEqual([]);
  });
});
