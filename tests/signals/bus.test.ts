import { describe, it, expect, vi } from 'vitest';
import { SignalBus } from '../../src/signals/bus';
import type { Sink } from '../../src/sinks/types';
import type { Signal } from '../../src/signals/types';

const sample = (): Signal => ({
  id: 'id1', ts: '2026-04-25T00:00:00Z', strategy: 's',
  type: 't', severity: 'info', payload: {},
});

function makeFakePool(seen: any[][]) {
  return { query: vi.fn(async (_s: string, v: any[]) => { seen.push(v); return { rows: [] } as any; }) } as any;
}

describe('SignalBus', () => {
  it('fans out to all sinks and writes signal_log row', async () => {
    const calls: string[] = [];
    const a: Sink = { name: 'a', emit: async () => { calls.push('a'); } };
    const b: Sink = { name: 'b', emit: async () => { calls.push('b'); } };
    const seen: any[][] = [];
    const bus = new SignalBus({ sinks: [a, b], pool: makeFakePool(seen) });
    await bus.emit(sample());
    expect(calls.sort()).toEqual(['a', 'b']);
    expect(seen).toHaveLength(1);
  });

  it('isolates sink failures', async () => {
    const ok: Sink = { name: 'ok', emit: async () => {} };
    const bad: Sink = { name: 'bad', emit: async () => { throw new Error('boom'); } };
    const onSinkError = vi.fn();
    const bus = new SignalBus({
      sinks: [ok, bad],
      pool: makeFakePool([]),
      onSinkError,
    });
    await bus.emit(sample());
    expect(onSinkError).toHaveBeenCalledWith('bad', expect.any(Error));
  });

  it('does not throw if pool insert fails', async () => {
    const bus = new SignalBus({
      sinks: [],
      pool: { query: vi.fn(async () => { throw new Error('db'); }) } as any,
      onPersistError: () => {},
    });
    await expect(bus.emit(sample())).resolves.not.toThrow();
  });
});
