import { describe, it, expect, vi } from 'vitest';
import { Cursors } from '../../src/resume/cursors';

function poolWith(rows: Record<string, { last_seq: string; last_ts: string }>) {
  return {
    query: vi.fn(async (sql: string, vals?: any[]) => {
      if (sql.trim().startsWith('SELECT')) {
        return { rows: Object.entries(rows).map(([stream, v]) => ({ stream, ...v })) };
      }
      const [stream, seq, ts] = vals ?? [];
      rows[stream] = { last_seq: String(seq), last_ts: ts };
      return { rows: [] };
    }),
  } as any;
}

describe('Cursors', () => {
  it('loads existing rows on init', async () => {
    const c = new Cursors(poolWith({ s1: { last_seq: '10', last_ts: '2026-04-25T00:00:00Z' } }));
    await c.load();
    expect(c.get('s1')?.lastSeq).toBe(10);
  });

  it('upserts and caches', async () => {
    const data: any = {};
    const c = new Cursors(poolWith(data));
    await c.load();
    await c.set('s2', 5, '2026-04-25T00:00:01Z');
    expect(c.get('s2')?.lastSeq).toBe(5);
    expect(data.s2.last_seq).toBe('5');
  });
});
