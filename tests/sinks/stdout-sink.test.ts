import { describe, it, expect } from 'vitest';
import { StdoutSink } from '../../src/sinks/stdout-sink';

describe('StdoutSink', () => {
  it('writes JSON line', async () => {
    const writes: string[] = [];
    const sink = new StdoutSink((s) => writes.push(s));
    await sink.emit({
      id: 'x', ts: '2026-04-25T00:00:00Z', strategy: 's',
      type: 't', severity: 'info', payload: { a: 1 },
    });
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).id).toBe('x');
    expect(writes[0]!.endsWith('\n')).toBe(true);
  });
});
