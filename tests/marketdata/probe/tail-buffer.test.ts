import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TailBuffer } from '../../../src/marketdata/probe/tail-buffer';

describe('TailBuffer', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tail-')); });

  it('caps buffer at capacity and drops oldest', () => {
    const tb = new TailBuffer({ capacity: 3, dir });
    for (let i = 0; i < 5; i++) tb.push('depth-update', { ts: i, raw: { i } });
    const out = tb.snapshot('depth-update');
    expect(out.map((f) => f.ts)).toEqual([2, 3, 4]);
  });

  it('isolates per channel', () => {
    const tb = new TailBuffer({ capacity: 5, dir });
    tb.push('depth-update', { ts: 1, raw: {} });
    tb.push('new-trade',     { ts: 2, raw: {} });
    expect(tb.snapshot('depth-update')).toHaveLength(1);
    expect(tb.snapshot('new-trade')).toHaveLength(1);
  });

  it('dump writes JSONL files per channel', async () => {
    const tb = new TailBuffer({ capacity: 5, dir });
    tb.push('depth-update', { ts: 1, raw: { a: 1 } });
    tb.push('new-trade',     { ts: 2, raw: { b: 2 } });
    const written = await tb.dump();
    expect(written.length).toBe(2);
    for (const f of written) {
      const lines = readFileSync(f, 'utf8').trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]!)).toHaveProperty('raw');
    }
  });
});
