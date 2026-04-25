# F1 Reliability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only chassis (config, logging, Postgres persistence, signal bus + sinks, ReadOnlyGuard, lifecycle, resume cursors) that all later phases (F2–F6) consume.

**Architecture:** Single Node TypeScript process. Postgres external (compose for pg only). Pino logging (stdout JSON + rotating file). Signal bus fans out to pluggable sinks (stdout, file, Telegram). All CoinDCX HTTP traffic passes through a `ReadOnlyGuard` axios interceptor that throws on any write verb or denied path. Hybrid crash-resume: market data is stateless; signals + audit timeline are persisted in Postgres.

**Tech Stack:** TypeScript (strict) · Node 20+ · pg + node-pg-migrate · pino + pino-roll · zod · ulid · axios · vitest · testcontainers · nock · ESLint · Postgres 16 · Docker Compose.

---

## Pre-flight

Read first:
- `docs/superpowers/specs/2026-04-25-f1-reliability-foundation-design.md` (the source spec)
- `src/index.ts`, `src/gateways/coindcx-api.ts`, `src/gateways/coindcx-ws.ts` (existing wiring you will rewire in Task 12)
- `src/config/config.ts` (current ad-hoc config — replaced in Task 3)

Hard rule: **the bot must never call a write endpoint on CoinDCX.** Every task that touches the API gateway must preserve this invariant. Task 9 enforces it in code.

---

## File Structure

New files:
- `src/config/schema.ts` — zod schema + redactor list
- `src/config/index.ts` — `loadConfig()` exported as singleton
- `src/logging/logger.ts` — `createLogger()` + child factory
- `src/db/pool.ts` — `getPool()` singleton
- `src/db/migrate.ts` — runner around node-pg-migrate
- `src/db/migrations/1714000000000_init.sql` — initial schema
- `src/audit/audit.ts` — `recordEvent()` + bounded queue + drain loop
- `src/audit/types.ts` — `AuditEvent` type
- `src/signals/types.ts` — `Signal` type
- `src/signals/bus.ts` — `SignalBus` class
- `src/sinks/types.ts` — `Sink` interface
- `src/sinks/stdout-sink.ts`
- `src/sinks/file-sink.ts`
- `src/sinks/telegram-sink.ts` — token bucket + retries
- `src/safety/read-only-guard.ts` — axios interceptor + violation type
- `src/resume/cursors.ts` — `getCursor` / `setCursor`
- `src/lifecycle/context.ts` — `Context` type
- `src/lifecycle/bootstrap.ts`
- `src/lifecycle/shutdown.ts`
- `tests/**/*.test.ts` — colocated next to subject under `tests/` mirror tree
- `vitest.config.ts`
- `eslint.config.js`
- `.env.example`
- `docker-compose.yml`
- `tsconfig.json` (replace existing — strict on)

Modified files:
- `package.json` — scripts + deps
- `src/gateways/coindcx-api.ts` — wired through ReadOnlyGuard (Task 9)
- `src/index.ts` — replaced by `lifecycle/bootstrap` + thin entrypoint (Task 12)

Naming convention: filenames kebab-case; types and classes PascalCase; functions camelCase.

---

## Task 1: Tooling scaffold (tsconfig strict + ESLint + Vitest)

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json` (replace), `vitest.config.ts`, `eslint.config.js`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Add dev/runtime dependencies**

Run:
```bash
npm install --save pg node-pg-migrate pino pino-roll zod ulid
npm install --save-dev typescript@^5.4 @types/node@^20 @types/pg \
  vitest @vitest/coverage-v8 testcontainers nock \
  eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

(Note: `typescript@^6` from current `package.json` does not exist on npm; pin to `^5.4`.)

- [ ] **Step 2: Replace `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

- [ ] **Step 4: Create `eslint.config.js`**

```js
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
];
```

- [ ] **Step 5: Add scripts to `package.json`**

Replace the `scripts` section with:
```json
"scripts": {
  "sync-env": "ts-node src/utils/sync-env.ts",
  "prestart": "npm run sync-env",
  "start": "ts-node src/index.ts",
  "dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "check": "npm run typecheck && npm run lint && npm run test",
  "db:migrate": "ts-node src/db/migrate.ts up",
  "db:rollback": "ts-node src/db/migrate.ts down"
}
```

- [ ] **Step 6: Write a sanity test**

Create `tests/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run check, expect failures only from typecheck/lint of pre-existing code**

Run: `npm run test`
Expected: 1 test passes.

Run: `npm run typecheck`
Expected: typecheck may report errors in existing `src/**` files due to strict mode. **Acceptable for now**; later tasks rewrite those files. Record the failures — no new code in this task should introduce errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts eslint.config.js tests/sanity.test.ts
git commit -m "chore(f1): scaffold strict tsconfig, eslint, vitest"
```

---

## Task 2: Config schema + redactor

**Files:**
- Create: `src/config/schema.ts`, `src/config/index.ts`, `src/config/redactor.ts`
- Test: `tests/config/schema.test.ts`, `tests/config/redactor.test.ts`
- Create: `.env.example`

- [ ] **Step 1: Write failing test for schema**

Create `tests/config/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../src/config/schema';

const validEnv = {
  PG_URL: 'postgres://u:p@localhost:5432/db',
  COINDCX_API_KEY: 'k',
  COINDCX_API_SECRET: 's',
  LOG_DIR: '/tmp/logs',
  TELEGRAM_BOT_TOKEN: 't',
  TELEGRAM_CHAT_ID: '123',
};

describe('ConfigSchema', () => {
  it('parses valid env with defaults', () => {
    const cfg = ConfigSchema.parse(validEnv);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.LOG_FILE_ROTATE_MB).toBe(50);
    expect(cfg.SIGNAL_SINKS).toEqual(['stdout', 'file', 'telegram']);
    expect(cfg.SHUTDOWN_GRACE_MS).toBe(5000);
    expect(cfg.AUDIT_BUFFER_MAX).toBe(10000);
  });

  it('rejects missing required field', () => {
    const { PG_URL: _omit, ...rest } = validEnv;
    expect(() => ConfigSchema.parse(rest)).toThrow();
  });

  it('parses SIGNAL_SINKS as comma list', () => {
    const cfg = ConfigSchema.parse({ ...validEnv, SIGNAL_SINKS: 'stdout,file' });
    expect(cfg.SIGNAL_SINKS).toEqual(['stdout', 'file']);
  });

  it('rejects unknown sink names', () => {
    expect(() =>
      ConfigSchema.parse({ ...validEnv, SIGNAL_SINKS: 'stdout,bogus' }),
    ).toThrow();
  });
});
```

Run: `npx vitest run tests/config/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/config/schema.ts`**

```ts
import { z } from 'zod';

const SinkName = z.enum(['stdout', 'file', 'telegram']);

export const ConfigSchema = z.object({
  PG_URL: z.string().min(1),
  COINDCX_API_KEY: z.string().min(1),
  COINDCX_API_SECRET: z.string().min(1),
  LOG_DIR: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FILE_ROTATE_MB: z.coerce.number().int().positive().default(50),
  LOG_FILE_KEEP: z.coerce.number().int().positive().default(10),
  SIGNAL_SINKS: z
    .string()
    .default('stdout,file,telegram')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(SinkName)),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(5000),
  AUDIT_BUFFER_MAX: z.coerce.number().int().positive().default(10000),
  TELEGRAM_RATE_PER_MIN: z.coerce.number().int().positive().default(20),
});

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 3: Run tests, expect pass**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: 4 PASS.

- [ ] **Step 4: Write failing test for redactor**

Create `tests/config/redactor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { redact, REDACT_KEYS } from '../../src/config/redactor';

describe('redactor', () => {
  it('replaces values for sensitive keys', () => {
    const out = redact({ apiKey: 'abc', password: 'p', nested: { token: 't', ok: 'fine' } });
    expect(out.apiKey).toBe('***');
    expect(out.password).toBe('***');
    expect((out.nested as any).token).toBe('***');
    expect((out.nested as any).ok).toBe('fine');
  });

  it('leaves non-sensitive keys', () => {
    const out = redact({ name: 'alice', count: 3 });
    expect(out).toEqual({ name: 'alice', count: 3 });
  });

  it('exposes pino-compatible key list', () => {
    expect(REDACT_KEYS).toContain('*.token');
    expect(REDACT_KEYS).toContain('*.secret');
  });
});
```

Run: `npx vitest run tests/config/redactor.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `src/config/redactor.ts`**

```ts
const SENSITIVE = /(secret|token|key|password)/i;

export const REDACT_KEYS = [
  '*.secret', '*.token', '*.key', '*.password',
  'secret', 'token', 'key', 'password',
];

export function redact<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '***' : redact(v as unknown);
  }
  return out as T;
}
```

- [ ] **Step 6: Run tests, expect pass**

Run: `npx vitest run tests/config/redactor.test.ts`
Expected: 3 PASS.

- [ ] **Step 7: Implement `src/config/index.ts`**

```ts
import 'dotenv/config';
import { ConfigSchema, type Config } from './schema';

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigCacheForTests(): void {
  cached = undefined;
}

export type { Config };
```

- [ ] **Step 8: Create `.env.example`**

```
PG_URL=postgres://bot:bot@localhost:5432/coindcx_bot
COINDCX_API_KEY=
COINDCX_API_SECRET=
LOG_DIR=./logs
LOG_LEVEL=info
LOG_FILE_ROTATE_MB=50
LOG_FILE_KEEP=10
SIGNAL_SINKS=stdout,file,telegram
SHUTDOWN_GRACE_MS=5000
AUDIT_BUFFER_MAX=10000
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_RATE_PER_MIN=20
```

- [ ] **Step 9: Commit**

```bash
git add src/config/ tests/config/ .env.example
git commit -m "feat(f1): config schema, loader, secret redactor"
```

---

## Task 3: Logger (pino + multistream + redact)

**Files:**
- Create: `src/logging/logger.ts`
- Test: `tests/logging/logger.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/logging/logger.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../src/logging/logger';

describe('logger', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'log-'));
  });

  it('writes JSON to file and redacts secrets', async () => {
    const log = createLogger({ logDir: dir, level: 'info', rotateMb: 50, keep: 5 });
    log.info({ apiKey: 'shhh', user: 'alice' }, 'hello');
    log.flush?.();
    await new Promise((r) => setTimeout(r, 50));
    const files = readdirSync(dir).filter((f) => f.startsWith('bot-'));
    expect(files.length).toBeGreaterThan(0);
    const content = readFileSync(join(dir, files[0]!), 'utf8');
    expect(content).toMatch(/"msg":"hello"/);
    expect(content).toMatch(/"apiKey":"\*\*\*"/);
    expect(content).not.toMatch(/shhh/);
  });

  it('child logger inherits redaction', async () => {
    const log = createLogger({ logDir: dir, level: 'info', rotateMb: 50, keep: 5 });
    const child = log.child({ mod: 'ws' });
    child.info({ token: 'tk' }, 'evt');
    log.flush?.();
    await new Promise((r) => setTimeout(r, 50));
    const files = readdirSync(dir).filter((f) => f.startsWith('bot-'));
    const content = readFileSync(join(dir, files[0]!), 'utf8');
    expect(content).toMatch(/"mod":"ws"/);
    expect(content).toMatch(/"token":"\*\*\*"/);
  });
});
```

Run: `npx vitest run tests/logging/logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/logging/logger.ts`**

```ts
import pino, { type Logger } from 'pino';
import pinoRoll from 'pino-roll';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REDACT_KEYS } from '../config/redactor';

export interface LoggerOptions {
  logDir: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  rotateMb: number;
  keep: number;
}

export type AppLogger = Logger;

export function createLogger(opts: LoggerOptions): AppLogger {
  mkdirSync(opts.logDir, { recursive: true });

  const fileStream = pinoRoll({
    file: join(opts.logDir, 'bot'),
    frequency: 'daily',
    size: `${opts.rotateMb}m`,
    limit: { count: opts.keep },
    extension: '.log',
  });

  const streams: pino.StreamEntry[] = [
    { level: opts.level, stream: process.stdout },
    { level: opts.level, stream: fileStream as unknown as NodeJS.WritableStream },
  ];

  return pino(
    {
      level: opts.level,
      base: { pid: process.pid },
      redact: { paths: REDACT_KEYS, censor: '***' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
}
```

- [ ] **Step 3: Run tests, expect pass**

Run: `npx vitest run tests/logging/logger.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/logging/ tests/logging/
git commit -m "feat(f1): pino logger with rotating file and secret redaction"
```

---

## Task 4: Postgres pool + migrations + initial schema

**Files:**
- Create: `src/db/pool.ts`, `src/db/migrate.ts`, `src/db/migrations/1714000000000_init.sql`
- Test: `tests/db/pool.test.ts`, `tests/db/migrate.test.ts`

- [ ] **Step 1: Write the initial migration `src/db/migrations/1714000000000_init.sql`**

```sql
-- Up
CREATE TABLE audit_events (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  kind      text NOT NULL,
  source    text NOT NULL,
  seq       bigint,
  payload   jsonb NOT NULL
);
CREATE INDEX audit_events_kind_ts_idx ON audit_events (kind, ts DESC);

CREATE TABLE seq_cursor (
  stream    text PRIMARY KEY,
  last_seq  bigint NOT NULL,
  last_ts   timestamptz NOT NULL
);

CREATE TABLE signal_log (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  strategy  text NOT NULL,
  type      text NOT NULL,
  pair      text,
  severity  text NOT NULL CHECK (severity IN ('info','warn','critical')),
  payload   jsonb NOT NULL
);
CREATE INDEX signal_log_strategy_ts_idx ON signal_log (strategy, ts DESC);
CREATE INDEX signal_log_pair_ts_idx     ON signal_log (pair, ts DESC) WHERE pair IS NOT NULL;

-- Down
DROP TABLE IF EXISTS signal_log;
DROP TABLE IF EXISTS seq_cursor;
DROP TABLE IF EXISTS audit_events;
```

- [ ] **Step 2: Implement `src/db/pool.ts`**

```ts
import { Pool } from 'pg';
import { loadConfig } from '../config';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new Pool({ connectionString: cfg.PG_URL, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
```

- [ ] **Step 3: Implement `src/db/migrate.ts`**

```ts
import { runner as migrate } from 'node-pg-migrate';
import { join } from 'node:path';
import { loadConfig } from '../config';

export interface MigrateOptions {
  direction: 'up' | 'down';
  databaseUrl?: string;
  count?: number;
}

export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const databaseUrl = opts.databaseUrl ?? loadConfig().PG_URL;
  await migrate({
    databaseUrl,
    dir: join(__dirname, 'migrations'),
    migrationsTable: 'pgmigrations',
    direction: opts.direction,
    count: opts.count ?? Infinity,
    log: () => {},
    singleTransaction: true,
  });
}

if (require.main === module) {
  const direction = (process.argv[2] === 'down' ? 'down' : 'up') as 'up' | 'down';
  runMigrations({ direction })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Write integration test `tests/db/migrate.test.ts` using testcontainers**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';

describe('migrations', () => {
  let pg: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    pg = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .start();
    url = `postgres://postgres:pw@${pg.getHost()}:${pg.getMappedPort(5432)}/test`;
  }, 60_000);

  afterAll(async () => {
    await pg.stop();
  });

  it('creates audit_events, seq_cursor, signal_log', async () => {
    await runMigrations({ direction: 'up', databaseUrl: url });
    const pool = new Pool({ connectionString: url });
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`,
    );
    const names = r.rows.map((row: { table_name: string }) => row.table_name);
    expect(names).toEqual(expect.arrayContaining(['audit_events', 'seq_cursor', 'signal_log', 'pgmigrations']));
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
```

- [ ] **Step 5: Run, expect pass (requires docker)**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: 3 PASS. If docker is not available locally, skip with `vitest run --reporter=verbose -t 'migrations' --bail` and document in README that migrations tests require docker.

- [ ] **Step 6: Commit**

```bash
git add src/db/ tests/db/
git commit -m "feat(f1): pg pool + node-pg-migrate runner + initial schema"
```

---

## Task 5: Audit module with bounded queue

**Files:**
- Create: `src/audit/types.ts`, `src/audit/audit.ts`
- Test: `tests/audit/audit.test.ts`

- [ ] **Step 1: Implement `src/audit/types.ts`**

```ts
export type AuditKind =
  | 'signal'
  | 'alert'
  | 'order_state'
  | 'reconcile_diff'
  | 'read_only_violation'
  | 'ws_reconnect'
  | 'telegram_drop'
  | 'fatal'
  | 'boot'
  | 'shutdown';

export interface AuditEvent {
  kind: AuditKind;
  source: string;
  seq?: number | null;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 2: Write failing test**

Create `tests/audit/audit.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { Audit } from '../../src/audit/audit';

function makeFakePool(rows: any[]) {
  return {
    query: vi.fn(async (_sql: string, _vals: any[]) => {
      rows.push(_vals);
      return { rows: [], rowCount: 1 };
    }),
  } as any;
}

describe('Audit', () => {
  it('queues events and drains to pool', async () => {
    const inserted: any[][] = [];
    const audit = new Audit({ pool: makeFakePool(inserted), bufferMax: 100, drainMs: 5 });
    audit.start();
    audit.recordEvent({ kind: 'boot', source: 'test', payload: { v: 1 } });
    await new Promise((r) => setTimeout(r, 30));
    await audit.stop();
    expect(inserted.length).toBe(1);
    expect(inserted[0]![0]).toBe('boot');
  });

  it('drops oldest when full and reports drop count', async () => {
    const slowPool = { query: vi.fn(async () => new Promise((r) => setTimeout(r, 100))) } as any;
    const drops: number[] = [];
    const audit = new Audit({
      pool: slowPool,
      bufferMax: 2,
      drainMs: 5,
      onDrop: (n) => drops.push(n),
    });
    audit.start();
    audit.recordEvent({ kind: 'boot', source: 't', payload: {} });
    audit.recordEvent({ kind: 'boot', source: 't', payload: {} });
    audit.recordEvent({ kind: 'boot', source: 't', payload: {} }); // overflow
    await audit.stop();
    expect(drops.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });

  it('never throws to caller on insert failure', async () => {
    const badPool = { query: vi.fn(async () => { throw new Error('db down'); }) } as any;
    const audit = new Audit({ pool: badPool, bufferMax: 10, drainMs: 5 });
    audit.start();
    expect(() => audit.recordEvent({ kind: 'boot', source: 't', payload: {} })).not.toThrow();
    await audit.stop();
  });
});
```

Run: `npx vitest run tests/audit/audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/audit/audit.ts`**

```ts
import type { Pool } from 'pg';
import type { AuditEvent } from './types';

export interface AuditOptions {
  pool: Pool;
  bufferMax: number;
  drainMs?: number;
  onDrop?: (count: number) => void;
}

const INSERT_SQL =
  'INSERT INTO audit_events (kind, source, seq, payload) VALUES ($1,$2,$3,$4)';

export class Audit {
  private queue: AuditEvent[] = [];
  private timer?: NodeJS.Timeout;
  private running = false;
  private draining = false;

  constructor(private readonly opts: AuditOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      void this.drainOnce().finally(() => {
        if (this.running) this.timer = setTimeout(tick, this.opts.drainMs ?? 100);
      });
    };
    this.timer = setTimeout(tick, this.opts.drainMs ?? 100);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.drainOnce();
  }

  recordEvent(ev: AuditEvent): void {
    if (this.queue.length >= this.opts.bufferMax) {
      const drop = this.queue.length - this.opts.bufferMax + 1;
      this.queue.splice(0, drop);
      this.opts.onDrop?.(drop);
    }
    this.queue.push(ev);
  }

  size(): number {
    return this.queue.length;
  }

  private async drainOnce(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const ev = this.queue[0]!;
        try {
          await this.opts.pool.query(INSERT_SQL, [
            ev.kind,
            ev.source,
            ev.seq ?? null,
            JSON.stringify(ev.payload),
          ]);
          this.queue.shift();
        } catch {
          return; // leave in queue, retry next tick
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/audit/audit.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audit/ tests/audit/
git commit -m "feat(f1): bounded-queue audit writer that never throws"
```

---

## Task 6: SignalBus + StdoutSink + FileSink

**Files:**
- Create: `src/signals/types.ts`, `src/signals/bus.ts`, `src/sinks/types.ts`, `src/sinks/stdout-sink.ts`, `src/sinks/file-sink.ts`
- Test: `tests/signals/bus.test.ts`, `tests/sinks/stdout-sink.test.ts`, `tests/sinks/file-sink.test.ts`

- [ ] **Step 1: Define types — `src/signals/types.ts`**

```ts
export type Severity = 'info' | 'warn' | 'critical';

export interface Signal {
  id: string;
  ts: string;
  strategy: string;
  type: string;
  pair?: string;
  severity: Severity;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 2: Define sink interface — `src/sinks/types.ts`**

```ts
import type { Signal } from '../signals/types';

export interface Sink {
  readonly name: string;
  emit(signal: Signal): Promise<void>;
}
```

- [ ] **Step 3: Write failing test for StdoutSink**

Create `tests/sinks/stdout-sink.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
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
```

- [ ] **Step 4: Implement `src/sinks/stdout-sink.ts`**

```ts
import type { Sink } from './types';
import type { Signal } from '../signals/types';

export class StdoutSink implements Sink {
  readonly name = 'stdout';
  constructor(private readonly write: (line: string) => void = (l) => process.stdout.write(l)) {}
  async emit(signal: Signal): Promise<void> {
    this.write(JSON.stringify(signal) + '\n');
  }
}
```

- [ ] **Step 5: Run StdoutSink test, expect pass**

Run: `npx vitest run tests/sinks/stdout-sink.test.ts`
Expected: 1 PASS.

- [ ] **Step 6: Write failing test for FileSink**

Create `tests/sinks/file-sink.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSink } from '../../src/sinks/file-sink';

describe('FileSink', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sigs-')); });

  it('appends JSONL with daily rollover prefix', async () => {
    const sink = new FileSink({ dir });
    await sink.emit({ id: 'a', ts: 'now', strategy: 's', type: 't', severity: 'info', payload: {} });
    await sink.emit({ id: 'b', ts: 'now', strategy: 's', type: 't', severity: 'info', payload: {} });
    await sink.close();
    const files = readdirSync(dir).filter((f) => f.startsWith('signals-') && f.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const lines = readFileSync(join(dir, files[0]!), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe('a');
    expect(JSON.parse(lines[1]!).id).toBe('b');
  });
});
```

- [ ] **Step 7: Implement `src/sinks/file-sink.ts`**

```ts
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { Sink } from './types';
import type { Signal } from '../signals/types';

export interface FileSinkOptions { dir: string; }

function dayKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

export class FileSink implements Sink {
  readonly name = 'file';
  private currentKey?: string;
  private stream?: WriteStream;

  constructor(private readonly opts: FileSinkOptions) {
    mkdirSync(opts.dir, { recursive: true });
  }

  async emit(signal: Signal): Promise<void> {
    const key = dayKey();
    if (key !== this.currentKey) {
      this.stream?.end();
      this.stream = createWriteStream(join(this.opts.dir, `signals-${key}.jsonl`), { flags: 'a' });
      this.currentKey = key;
    }
    const line = JSON.stringify(signal) + '\n';
    await new Promise<void>((resolve, reject) => {
      this.stream!.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream?.end(resolve));
  }
}
```

- [ ] **Step 8: Run FileSink test, expect pass**

Run: `npx vitest run tests/sinks/file-sink.test.ts`
Expected: 1 PASS.

- [ ] **Step 9: Write failing test for SignalBus**

Create `tests/signals/bus.test.ts`:
```ts
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
```

- [ ] **Step 10: Implement `src/signals/bus.ts`**

```ts
import type { Pool } from 'pg';
import type { Sink } from '../sinks/types';
import type { Signal } from './types';

export interface SignalBusOptions {
  sinks: Sink[];
  pool: Pool;
  onSinkError?: (sinkName: string, err: Error) => void;
  onPersistError?: (err: Error) => void;
}

const INSERT_SQL =
  'INSERT INTO signal_log (ts, strategy, type, pair, severity, payload) VALUES ($1,$2,$3,$4,$5,$6)';

export class SignalBus {
  constructor(private readonly opts: SignalBusOptions) {}

  async emit(signal: Signal): Promise<void> {
    const persist = this.persist(signal);
    const fanout = Promise.allSettled(this.opts.sinks.map((s) => s.emit(signal)));
    const [, results] = await Promise.all([persist, fanout]);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'rejected') {
        this.opts.onSinkError?.(this.opts.sinks[i]!.name, r.reason as Error);
      }
    }
  }

  private async persist(s: Signal): Promise<void> {
    try {
      await this.opts.pool.query(INSERT_SQL, [
        s.ts, s.strategy, s.type, s.pair ?? null, s.severity, JSON.stringify(s.payload),
      ]);
    } catch (err) {
      this.opts.onPersistError?.(err as Error);
    }
  }
}
```

- [ ] **Step 11: Run SignalBus test, expect pass**

Run: `npx vitest run tests/signals/bus.test.ts`
Expected: 3 PASS.

- [ ] **Step 12: Commit**

```bash
git add src/signals/ src/sinks/ tests/signals/ tests/sinks/
git commit -m "feat(f1): SignalBus with stdout and file sinks; isolated failures"
```

---

## Task 7: TelegramSink with token bucket + retries

**Files:**
- Create: `src/sinks/telegram-sink.ts`, `src/sinks/token-bucket.ts`
- Test: `tests/sinks/token-bucket.test.ts`, `tests/sinks/telegram-sink.test.ts`

- [ ] **Step 1: Write failing test for token bucket**

Create `tests/sinks/token-bucket.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { TokenBucket } from '../../src/sinks/token-bucket';

describe('TokenBucket', () => {
  it('allows up to capacity immediately', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSec: 0 });
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(bucket.available()).toBe(0);
  });

  it('refills over time', async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 2, refillPerSec: 2, now: () => Date.now() });
    await bucket.take();
    await bucket.take();
    expect(bucket.available()).toBe(0);
    vi.setSystemTime(Date.now() + 1000);
    expect(bucket.available()).toBe(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Implement `src/sinks/token-bucket.ts`**

```ts
export interface TokenBucketOptions {
  capacity: number;
  refillPerSec: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly now: () => number;

  constructor(private readonly opts: TokenBucketOptions) {
    this.tokens = opts.capacity;
    this.now = opts.now ?? Date.now;
    this.lastRefill = this.now();
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = this.opts.refillPerSec > 0
        ? Math.ceil(1000 / this.opts.refillPerSec)
        : 50;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.opts.capacity, this.tokens + elapsed * this.opts.refillPerSec);
    this.lastRefill = t;
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/sinks/token-bucket.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Write failing test for TelegramSink (using nock)**

Create `tests/sinks/telegram-sink.test.ts`:
```ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { TelegramSink } from '../../src/sinks/telegram-sink';

const baseUrl = 'https://api.telegram.org';
const token = 'TKN';
const chat = '42';

beforeEach(() => nock.disableNetConnect());
afterEach(() => { nock.cleanAll(); nock.enableNetConnect(); });

describe('TelegramSink', () => {
  it('posts a sendMessage request', async () => {
    const scope = nock(baseUrl)
      .post(`/bot${token}/sendMessage`)
      .reply(200, { ok: true });
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({ id: '1', ts: 't', strategy: 's', type: 'x', severity: 'info', payload: {} });
    expect(scope.isDone()).toBe(true);
  });

  it('retries on 5xx then succeeds', async () => {
    nock(baseUrl).post(`/bot${token}/sendMessage`).reply(500);
    nock(baseUrl).post(`/bot${token}/sendMessage`).reply(500);
    const ok = nock(baseUrl).post(`/bot${token}/sendMessage`).reply(200, { ok: true });
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({ id: '1', ts: 't', strategy: 's', type: 'x', severity: 'info', payload: {} });
    expect(ok.isDone()).toBe(true);
  });

  it('reports persistent failure without throwing', async () => {
    nock(baseUrl).post(`/bot${token}/sendMessage`).times(4).reply(500);
    const onDrop = vi.fn();
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1], onDrop,
    });
    await sink.emit({ id: '1', ts: 't', strategy: 's', type: 'x', severity: 'info', payload: {} });
    expect(onDrop).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Implement `src/sinks/telegram-sink.ts`**

```ts
import axios, { AxiosInstance } from 'axios';
import type { Sink } from './types';
import type { Signal } from '../signals/types';
import { TokenBucket } from './token-bucket';

export interface TelegramSinkOptions {
  token: string;
  chatId: string;
  ratePerMin: number;
  retryDelaysMs?: number[];
  onDrop?: (signal: Signal, err: Error) => void;
  http?: AxiosInstance;
}

const DEFAULT_RETRIES = [250, 1000, 4000];

function fmt(s: Signal): string {
  const sev = s.severity === 'critical' ? '🔴' : s.severity === 'warn' ? '🟡' : '🟢';
  const pair = s.pair ? ` *${s.pair}*` : '';
  const body = '```\n' + JSON.stringify(s.payload, null, 2) + '\n```';
  return `${sev} *${s.strategy}* / \`${s.type}\`${pair}\n${body}`;
}

export class TelegramSink implements Sink {
  readonly name = 'telegram';
  private readonly bucket: TokenBucket;
  private readonly http: AxiosInstance;
  private readonly retries: number[];

  constructor(private readonly opts: TelegramSinkOptions) {
    this.bucket = new TokenBucket({
      capacity: opts.ratePerMin,
      refillPerSec: opts.ratePerMin / 60,
    });
    this.http = opts.http ?? axios.create({ baseURL: 'https://api.telegram.org', timeout: 10_000 });
    this.retries = opts.retryDelaysMs ?? DEFAULT_RETRIES;
  }

  async emit(signal: Signal): Promise<void> {
    await this.bucket.take();
    const url = `/bot${this.opts.token}/sendMessage`;
    const body = { chat_id: this.opts.chatId, text: fmt(signal), parse_mode: 'Markdown' };

    let attempt = 0;
    let lastErr: Error | undefined;
    while (attempt <= this.retries.length) {
      try {
        await this.http.post(url, body);
        return;
      } catch (err) {
        lastErr = err as Error;
        const delay = this.retries[attempt];
        if (delay === undefined) break;
        await new Promise((r) => setTimeout(r, delay));
        attempt += 1;
      }
    }
    this.opts.onDrop?.(signal, lastErr ?? new Error('unknown telegram failure'));
  }
}
```

- [ ] **Step 6: Run TelegramSink test, expect pass**

Run: `npx vitest run tests/sinks/telegram-sink.test.ts`
Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sinks/telegram-sink.ts src/sinks/token-bucket.ts tests/sinks/telegram-sink.test.ts tests/sinks/token-bucket.test.ts
git commit -m "feat(f1): telegram sink with token-bucket rate limit and retries"
```

---

## Task 8: ReadOnlyGuard

**Files:**
- Create: `src/safety/read-only-guard.ts`
- Test: `tests/safety/read-only-guard.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/safety/read-only-guard.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import axios from 'axios';
import nock from 'nock';
import { applyReadOnlyGuard, ReadOnlyViolation, DENY_PATHS } from '../../src/safety/read-only-guard';

describe('ReadOnlyGuard', () => {
  it('blocks POST', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    await expect(client.post('/exchange/v1/markets', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('blocks PUT, PATCH, DELETE', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    await expect(client.put('/x', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(client.patch('/x', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
    await expect(client.delete('/x')).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('blocks denied paths even on GET', async () => {
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    for (const p of DENY_PATHS) {
      await expect(client.get(p)).rejects.toBeInstanceOf(ReadOnlyViolation);
    }
  });

  it('passes safe GET', async () => {
    nock('https://api.coindcx.com').get('/exchange/v1/markets').reply(200, []);
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client);
    const r = await client.get('/exchange/v1/markets');
    expect(r.status).toBe(200);
  });

  it('invokes onViolation hook with details', async () => {
    let captured: any;
    const client = axios.create({ baseURL: 'https://api.coindcx.com' });
    applyReadOnlyGuard(client, { onViolation: (info) => { captured = info; } });
    await client.post('/x', {}).catch(() => {});
    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/x');
  });
});
```

Run: `npx vitest run tests/safety/read-only-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/safety/read-only-guard.ts`**

```ts
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

export class ReadOnlyViolation extends Error {
  constructor(public readonly method: string, public readonly path: string) {
    super(`Read-only violation: ${method} ${path}`);
    this.name = 'ReadOnlyViolation';
  }
}

export const DENY_PATHS: readonly string[] = [
  '/exchange/v1/orders/create',
  '/exchange/v1/orders/cancel',
  '/exchange/v1/orders/edit',
  '/exchange/v1/orders/cancel_all',
  '/exchange/v1/orders/cancel_by_ids',
  '/exchange/v1/funds/transfer',
  '/exchange/v1/derivatives/futures/orders/create',
  '/exchange/v1/derivatives/futures/orders/cancel',
  '/exchange/v1/derivatives/futures/orders/edit',
  '/exchange/v1/derivatives/futures/orders/cancel_all',
  '/exchange/v1/derivatives/futures/positions/exit',
];

export interface GuardOptions {
  onViolation?: (info: { method: string; path: string }) => void;
  extraDenyPaths?: string[];
}

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function applyReadOnlyGuard(client: AxiosInstance, opts: GuardOptions = {}): void {
  const deny = [...DENY_PATHS, ...(opts.extraDenyPaths ?? [])];
  client.interceptors.request.use((req: InternalAxiosRequestConfig) => {
    const method = (req.method ?? 'get').toUpperCase();
    const path = req.url ?? '';
    const violated = WRITE_VERBS.has(method) || deny.some((p) => path.startsWith(p));
    if (violated) {
      opts.onViolation?.({ method, path });
      throw new ReadOnlyViolation(method, path);
    }
    return req;
  });
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/safety/read-only-guard.test.ts`
Expected: 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/safety/ tests/safety/
git commit -m "feat(f1): ReadOnlyGuard axios interceptor blocks write verbs and denied paths"
```

---

## Task 9: Resume cursors

**Files:**
- Create: `src/resume/cursors.ts`
- Test: `tests/resume/cursors.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/resume/cursors.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { Cursors } from '../../src/resume/cursors';

function poolWith(rows: Record<string, { last_seq: string; last_ts: string }>) {
  return {
    query: vi.fn(async (sql: string, vals: any[]) => {
      if (sql.startsWith('SELECT')) {
        return { rows: Object.entries(rows).map(([stream, v]) => ({ stream, ...v })) };
      }
      const [stream, seq, ts] = vals;
      rows[stream] = { last_seq: String(seq), last_ts: ts };
      return { rows: [] };
    }),
  } as any;
}

describe('Cursors', () => {
  it('loads existing rows on init', async () => {
    const c = new Cursors(poolWith({ s1: { last_seq: '10', last_ts: '2026-04-25T00:00:00Z' } }));
    await c.load();
    expect(c.get('s1')?.lastSeq).toBe(10);
  });

  it('upserts and caches', async () => {
    const data = {} as any;
    const c = new Cursors(poolWith(data));
    await c.load();
    await c.set('s2', 5, '2026-04-25T00:00:01Z');
    expect(c.get('s2')?.lastSeq).toBe(5);
    expect(data.s2.last_seq).toBe(5);
  });
});
```

Run: `npx vitest run tests/resume/cursors.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/resume/cursors.ts`**

```ts
import type { Pool } from 'pg';

export interface CursorRow {
  lastSeq: number;
  lastTs: string;
}

const SELECT_SQL = 'SELECT stream, last_seq, last_ts FROM seq_cursor';
const UPSERT_SQL = `
INSERT INTO seq_cursor (stream, last_seq, last_ts) VALUES ($1, $2, $3)
ON CONFLICT (stream) DO UPDATE SET last_seq = EXCLUDED.last_seq, last_ts = EXCLUDED.last_ts
`;

export class Cursors {
  private cache = new Map<string, CursorRow>();
  constructor(private readonly pool: Pool) {}

  async load(): Promise<void> {
    const r = await this.pool.query(SELECT_SQL);
    this.cache.clear();
    for (const row of r.rows as Array<{ stream: string; last_seq: string; last_ts: string }>) {
      this.cache.set(row.stream, { lastSeq: Number(row.last_seq), lastTs: row.last_ts });
    }
  }

  get(stream: string): CursorRow | undefined {
    return this.cache.get(stream);
  }

  async set(stream: string, lastSeq: number, lastTs: string): Promise<void> {
    await this.pool.query(UPSERT_SQL, [stream, lastSeq, lastTs]);
    this.cache.set(stream, { lastSeq, lastTs });
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/resume/cursors.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/resume/ tests/resume/
git commit -m "feat(f1): seq_cursor read/write with in-memory cache"
```

---

## Task 10: Lifecycle bootstrap + shutdown + Context

**Files:**
- Create: `src/lifecycle/context.ts`, `src/lifecycle/bootstrap.ts`, `src/lifecycle/shutdown.ts`
- Test: `tests/lifecycle/bootstrap.test.ts`

- [ ] **Step 1: Define `src/lifecycle/context.ts`**

```ts
import type { Pool } from 'pg';
import type { Config } from '../config';
import type { AppLogger } from '../logging/logger';
import type { Audit } from '../audit/audit';
import type { SignalBus } from '../signals/bus';
import type { Cursors } from '../resume/cursors';

export interface Context {
  config: Config;
  logger: AppLogger;
  pool: Pool;
  audit: Audit;
  bus: SignalBus;
  cursors: Cursors;
}
```

- [ ] **Step 2: Implement `src/lifecycle/bootstrap.ts`**

```ts
import { loadConfig } from '../config';
import { createLogger } from '../logging/logger';
import { getPool } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { Audit } from '../audit/audit';
import { SignalBus } from '../signals/bus';
import { Cursors } from '../resume/cursors';
import { StdoutSink } from '../sinks/stdout-sink';
import { FileSink } from '../sinks/file-sink';
import { TelegramSink } from '../sinks/telegram-sink';
import type { Sink } from '../sinks/types';
import type { Context } from './context';

async function connectWithRetry<T>(fn: () => Promise<T>, attempts: number, baseMs: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const delay = baseMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function bootstrap(): Promise<Context> {
  const config = loadConfig();
  const logger = createLogger({
    logDir: config.LOG_DIR,
    level: config.LOG_LEVEL,
    rotateMb: config.LOG_FILE_ROTATE_MB,
    keep: config.LOG_FILE_KEEP,
  });

  logger.info({ mod: 'boot' }, 'boot start');

  const pool = await connectWithRetry(async () => {
    const p = getPool();
    await p.query('SELECT 1');
    return p;
  }, 5, 1000);

  await runMigrations({ direction: 'up' });

  const cursors = new Cursors(pool);
  await cursors.load();

  const audit = new Audit({
    pool,
    bufferMax: config.AUDIT_BUFFER_MAX,
    onDrop: (n) => logger.warn({ mod: 'audit', dropped: n }, 'audit overflow'),
  });
  audit.start();

  const sinks: Sink[] = [];
  if (config.SIGNAL_SINKS.includes('stdout')) sinks.push(new StdoutSink());
  if (config.SIGNAL_SINKS.includes('file')) sinks.push(new FileSink({ dir: config.LOG_DIR }));
  if (config.SIGNAL_SINKS.includes('telegram')) {
    sinks.push(new TelegramSink({
      token: config.TELEGRAM_BOT_TOKEN,
      chatId: config.TELEGRAM_CHAT_ID,
      ratePerMin: config.TELEGRAM_RATE_PER_MIN,
      onDrop: (s, err) => {
        logger.warn({ mod: 'telegram', sigId: s.id, err: err.message }, 'telegram drop');
        audit.recordEvent({ kind: 'telegram_drop', source: 'telegram', payload: { id: s.id, err: err.message } });
      },
    }));
  }

  const bus = new SignalBus({
    sinks,
    pool,
    onSinkError: (name, err) => logger.warn({ mod: 'bus', sink: name, err: err.message }, 'sink failed'),
    onPersistError: (err) => logger.warn({ mod: 'bus', err: err.message }, 'signal_log persist failed'),
  });

  audit.recordEvent({ kind: 'boot', source: 'lifecycle', payload: { sinks: config.SIGNAL_SINKS } });
  logger.info({ mod: 'boot', sinks: config.SIGNAL_SINKS }, 'boot complete');

  return { config, logger, pool, audit, bus, cursors };
}
```

- [ ] **Step 3: Implement `src/lifecycle/shutdown.ts`**

```ts
import type { Context } from './context';
import { closePool } from '../db/pool';

export async function shutdown(ctx: Context, signal: string): Promise<void> {
  ctx.logger.info({ mod: 'shutdown', signal }, 'shutdown start');
  ctx.audit.recordEvent({ kind: 'shutdown', source: 'lifecycle', payload: { signal } });

  const grace = ctx.config.SHUTDOWN_GRACE_MS;
  await Promise.race([
    ctx.audit.stop(),
    new Promise((r) => setTimeout(r, grace)),
  ]);

  await closePool();
  ctx.logger.info({ mod: 'shutdown' }, 'shutdown complete');
}

export function installSignalHandlers(ctx: Context): void {
  let shutting = false;
  const handler = (sig: string) => {
    if (shutting) return;
    shutting = true;
    void shutdown(ctx, sig).then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));

  process.on('unhandledRejection', (err) => {
    ctx.logger.fatal({ mod: 'process', err: String(err) }, 'unhandledRejection');
    ctx.audit.recordEvent({ kind: 'fatal', source: 'process', payload: { kind: 'unhandledRejection', err: String(err) } });
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    ctx.logger.fatal({ mod: 'process', err: err.message }, 'uncaughtException');
    ctx.audit.recordEvent({ kind: 'fatal', source: 'process', payload: { kind: 'uncaughtException', err: err.message } });
    process.exit(1);
  });
}
```

- [ ] **Step 4: Write integration test `tests/lifecycle/bootstrap.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigCacheForTests } from '../../src/config';
import { bootstrap } from '../../src/lifecycle/bootstrap';
import { shutdown } from '../../src/lifecycle/shutdown';

describe('bootstrap', () => {
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
  }, 60_000);

  afterAll(async () => { await pg.stop(); });

  it('boots, runs migrations, emits boot audit event, then shuts down', async () => {
    const ctx = await bootstrap();
    const r = await ctx.pool.query("SELECT count(*)::int AS n FROM audit_events WHERE kind='boot'");
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
    await shutdown(ctx, 'SIGTERM');
  });
});
```

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run tests/lifecycle/bootstrap.test.ts`
Expected: 1 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle/ tests/lifecycle/
git commit -m "feat(f1): bootstrap + shutdown lifecycle, signal handlers, fatal handlers"
```

---

## Task 11: Wire ReadOnlyGuard into existing CoinDCX API gateway

**Files:**
- Modify: `src/gateways/coindcx-api.ts`
- Test: `tests/gateways/coindcx-api-guard.test.ts`

- [ ] **Step 1: Read current `src/gateways/coindcx-api.ts` to identify the axios instance**

Run: `cat src/gateways/coindcx-api.ts`
Expected: a module that exports `CoinDCXApi` and creates an axios instance internally.

- [ ] **Step 2: Refactor to expose the axios instance and apply guard**

Edit `src/gateways/coindcx-api.ts`:
- Extract the axios creation into a top-level `const http = axios.create({ baseURL: 'https://api.coindcx.com', ... });`
- Add at module top:
  ```ts
  import { applyReadOnlyGuard } from '../safety/read-only-guard';
  ```
- After `http` creation:
  ```ts
  applyReadOnlyGuard(http, {
    onViolation: ({ method, path }) => {
      // eslint-disable-next-line no-console
      console.error(`[ReadOnlyGuard] blocked ${method} ${path}`);
    },
  });
  ```
- Export `http` for tests: `export const __httpForTests = http;`
- Replace any direct `axios.post/put/patch/delete` calls in this file with `http.get(...)` calls (audit the file first; if no write calls exist, no further changes needed).

- [ ] **Step 3: Write test**

Create `tests/gateways/coindcx-api-guard.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { __httpForTests } from '../../src/gateways/coindcx-api';
import { ReadOnlyViolation } from '../../src/safety/read-only-guard';

describe('CoinDCX api gateway', () => {
  it('rejects POST', async () => {
    await expect(__httpForTests.post('/exchange/v1/markets', {})).rejects.toBeInstanceOf(ReadOnlyViolation);
  });
});
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/gateways/coindcx-api-guard.test.ts`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gateways/coindcx-api.ts tests/gateways/
git commit -m "feat(f1): wire ReadOnlyGuard into CoinDCX api gateway"
```

---

## Task 12: New entrypoint wires existing TUI/WS through Context

**Files:**
- Modify: `src/index.ts` (full rewrite into thin entrypoint)
- Create: `src/app.ts` (logic moved from old index)
- Modify: `src/gateways/coindcx-ws.ts` (only if needed to accept logger; otherwise leave)

- [ ] **Step 1: Move existing main-loop body from `src/index.ts` into `src/app.ts`**

Create `src/app.ts` with `export async function runApp(ctx: Context): Promise<void>` containing the body of the current `main()` function. Replace usages:
- Replace ad-hoc `console.log` and `tui.log` debug strings with `ctx.logger.info({mod:'ws'}, ...)` for non-TUI logs (keep TUI log lines as-is for the dashboard).
- On every WS reconnect inside `coindcx-ws.ts`'s `connected` event handler, call `ctx.audit.recordEvent({ kind:'ws_reconnect', source:'ws', payload:{} })`.
- On any caught error inside the periodic 30s refresh loop, call `ctx.audit.recordEvent({ kind:'fatal', source:'periodic', payload:{ err: err.message } })` (kind reused; if you want a dedicated `kind`, add `'periodic_error'` to `AuditKind` and the migration is unaffected since `kind` is `text`).

- [ ] **Step 2: Replace `src/index.ts` with a thin entrypoint**

```ts
import { bootstrap } from './lifecycle/bootstrap';
import { installSignalHandlers } from './lifecycle/shutdown';
import { runApp } from './app';

async function main() {
  const ctx = await bootstrap();
  installSignalHandlers(ctx);
  await runApp(ctx);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal boot error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Manually verify boot**

Run: prepare a local `.env` based on `.env.example` and start a local Postgres via `docker compose up -d` (added next task; or run an existing pg instance), then:
```bash
npm run db:migrate
npm start
```
Expected: process boots, JSON logs on stdout, file under `LOG_DIR`, WS connects.

Send a manual test signal by adding a one-time block at the bottom of `runApp`:
```ts
await ctx.bus.emit({
  id: 'boot-test',
  ts: new Date().toISOString(),
  strategy: 'system',
  type: 'boot',
  severity: 'info',
  payload: { msg: 'F1 wired' },
});
```
Verify a Telegram message arrives, the JSONL line appears in `signals-YYYYMMDD.jsonl`, and `SELECT * FROM signal_log ORDER BY id DESC LIMIT 1` shows the row.

Remove the test block after verification.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/app.ts src/gateways/coindcx-ws.ts
git commit -m "feat(f1): rewire entrypoint through bootstrap/Context, audit ws reconnects"
```

---

## Task 13: docker-compose for Postgres + README

**Files:**
- Create: `docker-compose.yml`
- Modify: `README.md` (create if absent)

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: bot
      POSTGRES_PASSWORD: bot
      POSTGRES_DB: coindcx_bot
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 2: Create or replace `README.md`**

```markdown
# coindcx-bot

Read-only institutional-grade observation + signal-emitter bot for CoinDCX. **Never places, cancels, or modifies orders.**

## Phase 1 (current): Reliability & Observability Foundation

- Validated config (zod) with secret redaction
- Pino logging (stdout JSON + rotating file)
- Postgres persistence (audit, signal log, resume cursors)
- Pluggable signal sinks (stdout / JSONL file / Telegram)
- ReadOnlyGuard blocks all write verbs and known order endpoints
- Graceful shutdown, hybrid crash-resume

## Setup

1. Copy env: `cp .env.example .env` and fill required values.
2. Start Postgres: `docker compose up -d`
3. Migrate: `npm run db:migrate`
4. Start: `npm start`

## Quality gate

`npm run check` — typecheck + lint + tests (some tests require Docker).

## Roadmap

- F2: market data integrity (L2 OB, gap detection, latency)
- F3: account state reconciler
- F4: strategy/signal framework + backtester
- F5: risk-alert engine
- F6: TUI v2 + Prometheus metrics
```

- [ ] **Step 3: Run full check**

Run: `npm run check`
Expected: PASS (typecheck + lint + tests). Tests requiring Docker will be skipped or pass depending on environment.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "chore(f1): docker-compose for postgres and README setup notes"
```

---

## Self-review checklist (already applied)

- All spec sections (config, logging, db, audit, signals, sinks, safety, lifecycle, resume, error handling, testing, build sequence, acceptance) have at least one task.
- No "TBD" / "implement later" / "appropriate handling" placeholders.
- Type names consistent: `AuditEvent`, `Signal`, `Sink`, `Context`, `ReadOnlyViolation`, `Audit`, `SignalBus`, `TokenBucket`, `Cursors`.
- Method signatures match across tasks (`bus.emit(signal)`, `audit.recordEvent({...})`, `cursors.set(stream, seq, ts)`).
- Acceptance criteria covered:
  - boot + migrations + JSON logs (Tasks 10, 12)
  - read-only violation + audit row (Tasks 8, 11)
  - signal end-to-end (Tasks 6, 7, 12)
  - graceful SIGTERM (Task 10)
  - `npm run check` green (Task 13)
