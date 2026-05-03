import { describe, expect, it, vi } from 'vitest';
import { RuntimePersistence } from '../../src/persistence/runtime-persistence';
import type { Signal } from '../../src/signals/types';

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-1',
    ts: '2026-05-03T13:00:00.000Z',
    strategy: 'llm.pulse.v1',
    type: 'strategy.long',
    pair: 'B-BTC_USDT',
    severity: 'warn',
    payload: { confidence: 0.8, reason: 'test' },
    ...overrides,
  };
}

describe('RuntimePersistence', () => {
  it('persists strategy signals into signals table', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [] }));
    const persistence = new RuntimePersistence({ query } as any);
    const input = signal();

    await persistence.persistSignal(input);

    expect(query).toHaveBeenCalledTimes(1);
    const firstCall = query.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const sql = firstCall[0];
    const params = firstCall[1];
    expect(sql).toMatch(/INSERT INTO signals/);
    expect(params).toEqual(expect.arrayContaining([input.id, input.type, input.strategy]));
  });

  it('persists risk and integrity events into risk_events table', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [] }));
    const persistence = new RuntimePersistence({ query } as any);

    await persistence.persistRiskEvent(
      signal({
        id: 'risk-1',
        strategy: 'integrity',
        type: 'book_resync',
        severity: 'critical',
      }),
    );

    expect(query).toHaveBeenCalledTimes(1);
    const firstCall = query.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const sql = firstCall[0];
    expect(sql).toMatch(/INSERT INTO risk_events/);
  });

  it('eligibility helpers match supported signal categories', () => {
    const persistence = new RuntimePersistence({ query: vi.fn() } as any);

    expect(persistence.isSignalEligible(signal({ type: 'strategy.short' }))).toBe(true);
    expect(persistence.isSignalEligible(signal({ type: 'strategy.wait' }))).toBe(true);
    expect(persistence.isSignalEligible(signal({ type: 'risk.blocked' }))).toBe(false);

    expect(persistence.isRiskEventEligible(signal({ type: 'risk.blocked' }))).toBe(true);
    expect(
      persistence.isRiskEventEligible(signal({ strategy: 'integrity', type: 'book_resync' })),
    ).toBe(true);
    expect(
      persistence.isRiskEventEligible(signal({ strategy: 'account.reconciler', type: 'reconcile.diff' })),
    ).toBe(true);
    expect(persistence.isRiskEventEligible(signal({ type: 'strategy.long' }))).toBe(false);
  });
});
