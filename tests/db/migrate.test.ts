import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';

const dockerAvailable = !process.env.SKIP_DOCKER_TESTS;

describe.skipIf(!dockerAvailable)('migrations', () => {
  let pg: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    pg = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .start();
    url = `postgres://postgres:pw@${pg.getHost()}:${pg.getMappedPort(5432)}/test`;
  }, 120_000);

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  it('creates audit_events, seq_cursor, signal_log', async () => {
    await runMigrations({ direction: 'up', databaseUrl: url });
    const pool = new Pool({ connectionString: url });
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`,
    );
    const names = r.rows.map((row: { table_name: string }) => row.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['audit_events', 'seq_cursor', 'signal_log', 'pgmigrations']),
    );
    await pool.end();
  });

  it('is idempotent', async () => {
    await runMigrations({ direction: 'up', databaseUrl: url });
    await runMigrations({ direction: 'up', databaseUrl: url });
  });

  it('rolls back', async () => {
    await runMigrations({ direction: 'down', databaseUrl: url });
    const pool = new Pool({ connectionString: url });
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema='public' AND table_name='audit_events'`,
    );
    expect(r.rows[0].n).toBe(0);
    await pool.end();
  });
});
