import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { IntegrityController } from '../../src/marketdata/integrity-controller';

class FakeWs extends EventEmitter {
  reconnect = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
}

describe('probe replay', () => {
  it('feeds recorded frames through controller and recovers from injected gap', async () => {
    const fixture = readFileSync(join(__dirname, '../fixtures/probe-sample.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    const ws = new FakeWs();
    const audit = { recordEvent: vi.fn() };
    const bus = { emit: vi.fn(async () => {}) };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
    const ic = new IntegrityController({
      config: {
        LOG_DIR: '/tmp', TAIL_BUFFER_SIZE: 10, LATENCY_RESERVOIR: 64, STALE_RESERVOIR: 16,
        STALE_FLOOR_depthUpdate: 1000, STALE_FLOOR_newTrade: 2000, STALE_FLOOR_currentPrices: 1000,
        HEARTBEAT_INTERVAL_MS: 100_000, HEARTBEAT_TIMEOUT_MS: 100_000,
        TIME_SYNC_INTERVAL_MS: 100_000, SKEW_THRESHOLD_MS: 100,
        RESYNC_WS_TIMEOUT_MS: 30,
        REST_BUDGET_GLOBAL_PER_MIN: 100, REST_BUDGET_PAIR_PER_MIN: 100, REST_BUDGET_TIMEOUT_MS: 100,
      } as any,
      logger, pool: {} as any, audit: audit as any, bus: bus as any, ws: ws as any,
      restFetchOrderBook: vi.fn(async () => ({ asks: [['10','1']] as any, bids: [['9','1']] as any, ts: Date.now() })),
      fetchExchangeMs: async () => Date.now(),
      fetchNtpMs: async () => Date.now(),
    });

    for (const f of fixture) ic.ingest(f.channel, f.raw);
    await new Promise((r) => setTimeout(r, 80));

    expect(ic.books.get('B-X_USDT')!.state()).toBe('live');
    const types = (bus.emit as any).mock.calls.map((c: any[]) => c[0].type);
    expect(types).toContain('book_resync');
  });
});
