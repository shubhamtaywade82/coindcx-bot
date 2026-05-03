import { describe, it, expect, vi } from 'vitest';
import { AccountReconcileController } from '../../src/account/reconcile-controller';

const mockSignalBus = () => {
  const emit = vi.fn().mockResolvedValue(undefined);
  return { bus: { emit } as any, emit };
};

const mockPersistence = () => ({
  upsertPosition: vi.fn().mockResolvedValue(undefined),
  upsertBalance: vi.fn().mockResolvedValue(undefined),
  upsertOrder: vi.fn().mockResolvedValue(undefined),
  appendFill: vi.fn().mockResolvedValue(undefined),
  recordChangelog: vi.fn().mockResolvedValue(undefined),
  recordAccountEventDedup: vi.fn().mockResolvedValue(true),
  flush: vi.fn().mockResolvedValue(undefined),
  queueSize: () => 0,
});

const mockRest = () => ({
  getFuturesPositions: vi.fn().mockResolvedValue({ data: [] }),
  getBalances: vi.fn().mockResolvedValue([]),
  getOpenOrders: vi.fn().mockResolvedValue({ data: [] }),
  getFuturesTradeHistory: vi.fn().mockResolvedValue({ data: [] }),
});

const baseConfig = {
  driftSweepMs: 1_000_000,
  heartbeatFloors: { position: 100_000, balance: 100_000, order: 100_000, fill: 100_000 },
  pnlAlarmPct: -0.10,
  utilAlarmPct: 0.90,
  divergencePnlAbsAlarm: 100,
  divergencePnlPctAlarm: 0.01,
  backfillHours: 24,
  signalCooldownMs: 100_000,
  stormThreshold: 20,
  stormWindowMs: 60_000,
};

describe('AccountReconcileController WS ingest', () => {
  it('upserts position and emits position.opened lifecycle', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' });
    expect(persist.upsertPosition).toHaveBeenCalled();
    expect(sig.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'position.opened' }));
  });

  it('emits fill.executed and appends to ledger', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.ingest('fill', { id: 'f1', pair: 'X', side: 'buy', price: 1, quantity: 1, executed_at: 't' });
    expect(persist.appendFill).toHaveBeenCalled();
    expect(sig.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'fill.executed' }));
  });

  it('snapshot returns AccountSnapshot shape', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    const s = c.snapshot();
    expect(s).toEqual(expect.objectContaining({
      positions: [], balances: [], orders: [],
      totals: expect.objectContaining({ equityInr: expect.any(String) }),
    }));
  });

  it('cooldown suppresses duplicate threshold signals', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 100,
      margin_currency_short_name: 'USDT', unrealized_pnl: -50, updated_at: 'now' });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 100,
      margin_currency_short_name: 'USDT', unrealized_pnl: -55, updated_at: 'now' });
    const calls = sig.emit.mock.calls.filter(c => (c[0] as any).type === 'position.pnl_threshold');
    expect(calls.length).toBe(1);
  });

  it('deduplicates order events by client_order_id + event_id', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    persist.recordAccountEventDedup
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });

    const raw = {
      id: 'o1',
      pair: 'B-BTC_USDT',
      status: 'open',
      total_quantity: '1',
      remaining_quantity: '1',
      client_order_id: 'cid-1',
      event_id: 'evt-1',
      updated_at: '2026-05-03T12:00:00.000Z',
      created_at: '2026-05-03T12:00:00.000Z',
    };
    await c.ingest('order', raw);
    await c.ingest('order', raw);

    expect(persist.upsertOrder).toHaveBeenCalledTimes(1);
  });
});

describe('AccountReconcileController seed + reconnect', () => {
  it('seed populates stores from REST', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    rest.getFuturesPositions.mockResolvedValue({ data: [{ id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' }] });
    rest.getBalances.mockResolvedValue([{ currency_short_name: 'USDT', balance: 100, locked_balance: 0 }]);
    rest.getOpenOrders.mockResolvedValue({ data: [] });
    rest.getFuturesTradeHistory.mockResolvedValue({ data: [] });
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.seed();
    expect(c.snapshot().positions).toHaveLength(1);
    expect(c.snapshot().balances).toHaveLength(1);
  });

  it('onWsReconnect triggers full sweep', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.onWsReconnect();
    expect(rest.getFuturesPositions).toHaveBeenCalled();
    expect(rest.getBalances).toHaveBeenCalled();
    expect(rest.getOpenOrders).toHaveBeenCalled();
    expect(rest.getFuturesTradeHistory).toHaveBeenCalled();
  });
});
