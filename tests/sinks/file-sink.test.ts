import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSink } from '../../src/sinks/file-sink';

describe('FileSink', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sigs-')); });

  it('appends JSONL with daily rollover prefix', async () => {
    const sink = new FileSink({ dir });
    await sink.emit({ id: 'a', ts: 'now', strategy: 's', type: 't', severity: 'info', payload: {} });
    await sink.emit({ id: 'b', ts: 'now', strategy: 's', type: 't', severity: 'info', payload: {} });
    await sink.close();
    const files = readdirSync(dir).filter((f) => f.startsWith('signals-') && f.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const lines = readFileSync(join(dir, files[0]!), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe('a');
    expect(JSON.parse(lines[1]!).id).toBe('b');
  });
});
