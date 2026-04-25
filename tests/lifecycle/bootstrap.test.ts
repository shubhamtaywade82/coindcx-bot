import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigCacheForTests } from '../../src/config';
import { bootstrap } from '../../src/lifecycle/bootstrap';
import { shutdown } from '../../src/lifecycle/shutdown';

const dockerAvailable = !process.env.SKIP_DOCKER_TESTS;

describe.skipIf(!dockerAvailable)('bootstrap', () => {
  let pg: StartedTestContainer;

  beforeAll(async () => {
    pg = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .start();
    process.env.PG_URL = `postgres://postgres:pw@${pg.getHost()}:${pg.getMappedPort(5432)}/test`;
    process.env.COINDCX_API_KEY = 'k';
    process.env.COINDCX_API_SECRET = 's';
    process.env.LOG_DIR = mkdtempSync(join(tmpdir(), 'boot-'));
    process.env.TELEGRAM_BOT_TOKEN = 't';
    process.env.TELEGRAM_CHAT_ID = '1';
    process.env.SIGNAL_SINKS = 'stdout,file';
    resetConfigCacheForTests();
  }, 120_000);

  afterAll(async () => { if (pg) await pg.stop(); });

  it('boots, runs migrations, emits boot audit event, then shuts down', async () => {
    const ctx = await bootstrap();
    await new Promise((r) => setTimeout(r, 300));
    const r = await ctx.pool.query("SELECT count(*)::int AS n FROM audit_events WHERE kind='boot'");
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
    await shutdown(ctx, 'SIGTERM');
  });
});
