import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { AccountReconcileController } from '../../src/account/reconcile-controller';
import { AccountPersistence } from '../../src/account/persistence';
import { SignalBus } from '../../src/signals/bus';

const DOCKER_OFF = process.env.SKIP_DOCKER_TESTS === '1';
const skip = DOCKER_OFF ? describe.skip : describe;

const PG = process.env.PG_URL ?? 'postgres://bot:bot@localhost:5433/coindcx_bot';

skip('AccountReconcileController integration', () => {
  let pool: Pool;
  let persistence: AccountPersistence;
  let bus: SignalBus;
  const sinkEmit = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    bus = new SignalBus({ pool, sinks: [{ name: 'memory', emit: sinkEmit }] });
    persistence = new AccountPersistence({ pool, retryMax: 1000 });
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query('TRUNCATE positions, balances, orders, fills_ledger, account_changelog CASCADE');
    sinkEmit.mockClear();
  });

  function rest(stub: Partial<{ positions: any[]; balances: any[]; orders: any[]; trades: any[] }>) {
    return {
      getFuturesPositions: vi.fn().mockResolvedValue({ data: stub.positions ?? [] }),
      getBalances: vi.fn().mockResolvedValue(stub.balances ?? []),
      getOpenOrders: vi.fn().mockResolvedValue({ data: stub.orders ?? [] }),
      getFuturesTradeHistory: vi.fn().mockResolvedValue({ data: stub.trades ?? [] }),
    };
  }

  const cfg = {
    driftSweepMs: 1_000_000,
    heartbeatFloors: { position: 100_000, balance: 100_000, order: 100_000, fill: 100_000 },
    pnlAlarmPct: -0.10, utilAlarmPct: 0.90,
    divergencePnlAbsAlarm: 100, divergencePnlPctAlarm: 0.01,
    backfillHours: 24, signalCooldownMs: 100_000,
    stormThreshold: 20, stormWindowMs: 60_000,
  };

  it('seed populates Postgres rows', async () => {
    const restApi = rest({
      positions: [{ id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' }],
      balances: [{ currency_short_name: 'USDT', balance: 100, locked_balance: 0 }],
    });
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    await c.seed();
    const positions = await pool.query('SELECT * FROM positions');
    expect(positions.rows).toHaveLength(1);
    expect(positions.rows[0]!.id).toBe('p1');
  });

  it('divergence alarm signal emitted when REST disagrees', async () => {
    const restApi = rest({
      positions: [{ id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' }],
    });
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 1.0, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' });
    await c.forcedSweep('position');
    const types = sinkEmit.mock.calls.map(call => (call[0] as any).type);
    expect(types).toContain('reconcile.divergence');
    const cl = await pool.query("SELECT * FROM account_changelog WHERE cause='divergence'");
    expect(cl.rows.length).toBeGreaterThan(0);
  });

  it('idempotent fill replay results in single row', async () => {
    const restApi = rest({});
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    const raw = { id: 'fA', pair: 'X', side: 'buy', price: 1, quantity: 1, executed_at: '2026-04-26T00:00:00Z' };
    await c.ingest('fill', raw);
    await c.ingest('fill', raw);
    await c.ingest('fill', raw);
    const fills = await pool.query('SELECT * FROM fills_ledger');
    expect(fills.rows).toHaveLength(1);
    const fillSignals = sinkEmit.mock.calls.filter(c => (c[0] as any).type === 'fill.executed');
    expect(fillSignals.length).toBe(1);
  });

  it('synthesized close emits position.closed when REST sweep finds row gone', async () => {
    const restApi = rest({ positions: [] });
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 1, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' });
    await c.forcedSweep('position');
    const types = sinkEmit.mock.calls.map(call => (call[0] as any).type);
    expect(types).toContain('position.closed');
  });
});
