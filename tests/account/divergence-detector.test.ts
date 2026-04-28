import { describe, it, expect } from 'vitest';
import { DivergenceDetector } from '../../src/account/divergence-detector';
import type { Position } from '../../src/account/types';

const p1: Position = {
  id: 'p1', pair: 'B-BTC_USDT', side: 'long',
  activePos: '0.5', avgPrice: '50000', markPrice: '50100',
  marginCurrency: 'USDT', unrealizedPnl: '50', realizedPnl: '0',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

const cfg = { pnlAbsAlarm: 100, pnlPctAlarm: 0.01 };

describe('DivergenceDetector', () => {
  it('returns empty when local matches REST', () => {
    const d = new DivergenceDetector(cfg);
    expect(d.diffPositions([p1], [{ ...p1, source: 'rest' }])).toEqual([]);
  });

  it('flags missing_in_local when REST has id local lacks', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([], [{ ...p1, source: 'rest' }]);
    expect(out).toEqual([{ kind: 'missing_in_local', id: 'p1', restRow: expect.objectContaining({ id: 'p1' }), severity: 'warn' }]);
  });

  it('flags missing_in_rest when local has id REST lacks', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], []);
    expect(out).toEqual([{ kind: 'missing_in_rest', id: 'p1', localRow: expect.objectContaining({ id: 'p1' }), severity: 'warn' }]);
  });

  it('alarms on activePos mismatch always', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], [{ ...p1, activePos: '0.4', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({
      kind: 'field_mismatch', field: 'activePos', severity: 'alarm',
    }));
  });

  it('alarms on pnl diff above absolute floor', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], [{ ...p1, unrealizedPnl: '500', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({
      kind: 'field_mismatch', field: 'unrealizedPnl', severity: 'alarm',
    }));
  });

  it('warns on pnl diff below absolute and percentage floor', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([{ ...p1, unrealizedPnl: '5000' }], [{ ...p1, unrealizedPnl: '5005', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({
      kind: 'field_mismatch', field: 'unrealizedPnl', severity: 'warn',
    }));
  });

  it('info severity on benign field (markPrice)', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], [{ ...p1, markPrice: '50200', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({ field: 'markPrice', severity: 'info' }));
  });
});
