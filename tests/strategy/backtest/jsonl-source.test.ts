import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JsonlSource } from '../../../src/strategy/backtest/sources/jsonl-source';

describe('JsonlSource', () => {
  it('reads jsonl file and yields tick events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'f4-'));
    const file = join(dir, 'probe.jsonl');
    writeFileSync(file, [
      JSON.stringify({ ts: 1000, ch: 'new-trade', raw: { pair: 'p', price: 100 } }),
      JSON.stringify({ ts: 2000, ch: 'new-trade', raw: { pair: 'p', price: 101 } }),
    ].join('\n'));
    const src = new JsonlSource({ path: file, pair: 'p', fromMs: 0, toMs: 10_000 });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]!.price).toBe(100);
  });
});
