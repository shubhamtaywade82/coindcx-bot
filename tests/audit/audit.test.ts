import { describe, it, expect, vi } from 'vitest';
import { Audit } from '../../src/audit/audit';

function makeFakePool(rows: any[]) {
  return {
    query: vi.fn(async (_sql: string, vals: any[]) => {
      rows.push(vals);
      return { rows: [], rowCount: 1 };
    }),
  } as any;
}

describe('Audit', () => {
  it('queues events and drains to pool', async () => {
    const inserted: any[][] = [];
    const audit = new Audit({ pool: makeFakePool(inserted), bufferMax: 100, drainMs: 5 });
    audit.start();
    audit.recordEvent({ kind: 'boot', source: 'test', payload: { v: 1 } });
    await new Promise((r) => setTimeout(r, 30));
    await audit.stop();
    expect(inserted.length).toBe(1);
    expect(inserted[0]![0]).toBe('boot');
  });

  it('drops oldest when full and reports drop count', async () => {
    const slowPool = { query: vi.fn(async () => new Promise((r) => setTimeout(r, 100))) } as any;
    const drops: number[] = [];
    const audit = new Audit({
      pool: slowPool,
      bufferMax: 2,
      drainMs: 5,
      onDrop: (n) => drops.push(n),
    });
    audit.start();
    audit.recordEvent({ kind: 'boot', source: 't', payload: {} });
    audit.recordEvent({ kind: 'boot', source: 't', payload: {} });
    audit.recordEvent({ kind: 'boot', source: 't', payload: {} });
    await audit.stop();
    expect(drops.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });

  it('never throws to caller on insert failure', async () => {
    const badPool = { query: vi.fn(async () => { throw new Error('db down'); }) } as any;
    const audit = new Audit({ pool: badPool, bufferMax: 10, drainMs: 5 });
    audit.start();
    expect(() => audit.recordEvent({ kind: 'boot', source: 't', payload: {} })).not.toThrow();
    await audit.stop();
  });
});
