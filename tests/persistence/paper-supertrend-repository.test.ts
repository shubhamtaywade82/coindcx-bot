import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';
import { PaperSupertrendRepository } from '../../src/persistence/paper-supertrend-repository';

const DOCKER_OFF = process.env.SKIP_DOCKER_TESTS === '1';

describe.skipIf(DOCKER_OFF)('PaperSupertrendRepository (Postgres)', () => {
  let pg: StartedTestContainer;
  let pool: Pool;
  let url: string;

  beforeAll(async () => {
    pg = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .start();
    url = `postgres://postgres:pw@${pg.getHost()}:${pg.getMappedPort(5432)}/test`;
    await runMigrations({ direction: 'up', databaseUrl: url });
    pool = new Pool({ connectionString: url });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (pg) await pg.stop();
  });

  it('round-trips open → append leg → mark → close_tp', async () => {
    const repo = new PaperSupertrendRepository(pool);
    const created = await repo.createOpen({
      pair: 'B-ETH_USDT',
      side: 'LONG',
      capitalUsdt: 1000,
      legs: [{ ts: new Date().toISOString(), price: 100, notionalUsdt: 500, qty: 5 }],
      avgEntry: 100,
      totalNotionalUsdt: 500,
      tpPrice: 105,
      tpPct: 5,
      metadata: { k: 1 },
    });
    expect(created).not.toBeNull();
    const open = await repo.findOpen('B-ETH_USDT');
    expect(open?.pair).toBe('B-ETH_USDT');
    expect(open?.legs.length).toBe(1);

    const legs = [...(open?.legs ?? []), { ts: new Date().toISOString(), price: 90, notionalUsdt: 500, qty: 500 / 90 }];
    await repo.appendLeg({
      id: open!.id,
      legs,
      avgEntry: 95,
      totalNotionalUsdt: 1000,
      tpPrice: 104.5,
      tpPct: 10,
      metadata: { n: 2 },
    });
    const after = await repo.findOpen('B-ETH_USDT');
    expect(after?.legs.length).toBe(2);
    expect(after?.avgEntry).toBeCloseTo(95, 5);

    repo._resetMarkThrottleForTests('B-ETH_USDT');
    await repo.updateMark('B-ETH_USDT', { lastMarkPrice: 101, lastMarkPnlPct: 6.3 }, Date.now());
    const marked = await repo.findOpen('B-ETH_USDT');
    expect(marked?.lastMarkPrice).toBeCloseTo(101, 4);

    await repo.closeTp({ id: open!.id, realizedPnlUsdt: 12.5, realizedPnlPct: 1.25, metadata: { x: 3 } });
    const closed = await repo.findOpen('B-ETH_USDT');
    expect(closed).toBeNull();
    const r = await pool.query(`SELECT status, realized_pnl_usdt FROM paper_supertrend_positions WHERE id = $1`, [
      open!.id,
    ]);
    expect(r.rows[0]?.status).toBe('closed_tp');
    expect(Number(r.rows[0]?.realized_pnl_usdt)).toBeCloseTo(12.5, 4);
  });
});
