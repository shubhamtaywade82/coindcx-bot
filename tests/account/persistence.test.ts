import { describe, it, expect, vi } from 'vitest';
import { AccountPersistence } from '../../src/account/persistence';
import type { Position } from '../../src/account/types';

const p1: Position = {
  id: 'p1', pair: 'B-BTC_USDT', side: 'long',
  activePos: '0.5', avgPrice: '50000', markPrice: '50100',
  marginCurrency: 'USDT', unrealizedPnl: '50', realizedPnl: '0',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

function fakePool() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return {
    pool: { query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows: [] }; }) },
    calls,
  };
}

describe('AccountPersistence', () => {
  it('upsertPosition issues INSERT ... ON CONFLICT DO UPDATE', async () => {
    const f = fakePool();
    const p = new AccountPersistence({ pool: f.pool as any, retryMax: 100 });
    await p.upsertPosition(p1);
    expect(f.calls[0]!.sql).toMatch(/INSERT INTO positions/);
    expect(f.calls[0]!.sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(f.calls[0]!.params[0]).toBe('p1');
  });

  it('appendFill is idempotent via ON CONFLICT DO NOTHING', async () => {
    const f = fakePool();
    const p = new AccountPersistence({ pool: f.pool as any, retryMax: 100 });
    await p.appendFill({
      id: 'f1', pair: 'X', side: 'buy', price: '1', qty: '1',
      executedAt: '2026-04-26T00:00:00Z', ingestedAt: '2026-04-26T00:00:01Z', source: 'ws',
    });
    expect(f.calls[0]!.sql).toMatch(/INSERT INTO fills_ledger/);
    expect(f.calls[0]!.sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it('recordChangelog inserts into account_changelog', async () => {
    const f = fakePool();
    const p = new AccountPersistence({ pool: f.pool as any, retryMax: 100 });
    await p.recordChangelog({
      entity: 'position', entityId: 'p1', field: 'markPrice',
      oldValue: '50100', newValue: '51000', cause: 'ws_apply', severity: null,
    });
    expect(f.calls[0]!.sql).toMatch(/INSERT INTO account_changelog/);
    expect(f.calls[0]!.params).toEqual(expect.arrayContaining(['position', 'p1', 'markPrice', '50100', '51000', 'ws_apply', null]));
  });

  it('queues writes when pool throws and flushes on success', async () => {
    let fail = true;
    const calls: Array<{ sql: string; params: any[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (fail) throw new Error('pg down');
        calls.push({ sql, params });
        return { rows: [] };
      }),
    };
    const p = new AccountPersistence({ pool: pool as any, retryMax: 100 });
    await p.upsertPosition(p1);
    expect(p.queueSize()).toBe(1);
    fail = false;
    await p.flush();
    expect(p.queueSize()).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('drops oldest when retry buffer overflows', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('pg down'); }) };
    const p = new AccountPersistence({ pool: pool as any, retryMax: 2 });
    await p.upsertPosition({ ...p1, id: 'a' });
    await p.upsertPosition({ ...p1, id: 'b' });
    await p.upsertPosition({ ...p1, id: 'c' });
    expect(p.queueSize()).toBe(2);
  });
});
