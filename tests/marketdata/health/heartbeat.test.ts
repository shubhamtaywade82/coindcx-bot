import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Heartbeat } from '../../../src/marketdata/health/heartbeat';

class FakeWs extends EventEmitter {
  reconnect = vi.fn();
}

describe('Heartbeat', () => {
  it('records pong rtt', () => {
    const ws = new FakeWs();
    const onLatency = vi.fn();
    const hb = new Heartbeat({ ws: ws as any, intervalMs: 10_000, timeoutMs: 30_000, onLatency });
    hb.start();
    hb.markPing(1000);
    ws.emit('pong', 1024);
    expect(onLatency).toHaveBeenCalledWith(24);
    hb.stop();
  });

  it('triggers timeout alert + reconnect when no pong arrives', async () => {
    const ws = new FakeWs();
    const onTimeout = vi.fn();
    const hb = new Heartbeat({
      ws: ws as any, intervalMs: 50, timeoutMs: 30, onTimeout,
    });
    hb.start();
    hb.markPing(Date.now());
    await new Promise((r) => setTimeout(r, 60));
    expect(onTimeout).toHaveBeenCalled();
    expect(ws.reconnect).toHaveBeenCalled();
    hb.stop();
  });
});
