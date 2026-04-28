import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { IntegrityController } from '../../src/marketdata/integrity-controller';

class FakeWs extends EventEmitter {
  reconnect = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
}

function makeDeps(overrides: Partial<any> = {}) {
  const ws = new FakeWs();
  const audit = { recordEvent: vi.fn() };
  const bus = { emit: vi.fn(async () => {}) };
  const logger: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => logger,
  };
  return {
    config: {
      LOG_DIR: '/tmp',
      TAIL_BUFFER_SIZE: 10, LATENCY_RESERVOIR: 64, STALE_RESERVOIR: 16,
      STALE_FLOOR_depthUpdate: 1000, STALE_FLOOR_newTrade: 2000,
      STALE_FLOOR_currentPrices: 1000,
      HEARTBEAT_INTERVAL_MS: 100_000, HEARTBEAT_TIMEOUT_MS: 100_000,
      TIME_SYNC_INTERVAL_MS: 100_000, SKEW_THRESHOLD_MS: 100,
      RESYNC_WS_TIMEOUT_MS: 50,
      REST_BUDGET_GLOBAL_PER_MIN: 100, REST_BUDGET_PAIR_PER_MIN: 100,
      REST_BUDGET_TIMEOUT_MS: 100,
    } as any,
    logger,
    pool: {} as any,
    audit: audit as any,
    bus: bus as any,
    ws: ws as any,
    restFetchOrderBook: vi.fn(async () => ({ asks: [['10','1']] as any, bids: [['9','1']] as any, ts: Date.now() })),
    fetchExchangeMs: async () => Date.now(),
    fetchNtpMs: async () => Date.now(),
    ...overrides,
  };
}

describe('IntegrityController', () => {
  it('gap injection triggers REST resync and emits book_resync signal', async () => {
    const deps = makeDeps();
    const ic = new IntegrityController(deps as any);
    ic.ingest('depth-snapshot', { s: 'B-X_USDT', asks: [['1','1']], bids: [['0.5','1']] });
    ic.ingest('depth-update',   { s: 'B-X_USDT', asks: [['9','0']], bids: [] });
    await new Promise((r) => setTimeout(r, 100));
    expect(deps.restFetchOrderBook).toHaveBeenCalledWith('B-X_USDT');
    const types = (deps.bus.emit as any).mock.calls.map((c: any[]) => c[0].type);
    expect(types).toContain('book_resync');
  });
});
