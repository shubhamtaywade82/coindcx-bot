# F1 — Reliability & Observability Foundation

**Date:** 2026-04-25
**Status:** Draft for review
**Phase:** 1 of 6 in institutional-grade roadmap

## Hard Constraint

The CoinDCX bot is **read-only forever**. It never places, cancels, or modifies orders. It is an observer that emits signals based on analysis. F1 enforces this constraint in code via `ReadOnlyGuard`.

## Goals

Provide the chassis on which F2–F6 are built:

- Validated configuration with secret redaction
- Structured logging (stdout JSON + rotating file)
- Postgres persistence (pool, migrations, audit, signal log, resume cursors)
- Pluggable signal emission (stdout / file / Telegram)
- Read-only safety guard around the CoinDCX API gateway
- Lifecycle: bootstrap, graceful shutdown, crash-safe semantics
- Hybrid resume: stateless market data, persisted continuity for signals/audit
- TypeScript strict mode, lint, unit + integration tests, CI script

Out of scope (deferred to later phases): Prometheus metrics (F6), risk-alert engine (F5), strategy framework + backtester (F4), L2 orderbook + account reconciler (F2/F3), TUI v2 (F6).

## Decisions (already made during brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Persistence | Postgres |
| Q2 | Deployment | Single Node process + external Postgres (docker-compose for pg only) |
| Q3 | Signal sinks | Pluggable; primary webhook = Telegram |
| Q4 | Logging | stdout JSON + rotating file + Postgres audit table (signals/alerts/order-state-changes only) |
| Q5 | Metrics | Deferred to F6 |
| Q6 | Crash-resume | Hybrid — stateless market data, persisted resume for signals/audit |

## Architecture

```
src/
  config/        zod schema, env loader, secrets guard
  logging/       pino logger factory (stdout JSON + rotating file)
  db/            pg pool, migrations runner, audit repo
  audit/         AuditEvent type + insert helpers
  signals/       Signal type, SignalBus (pluggable sinks)
  sinks/         file-sink, stdout-sink, telegram-sink
  lifecycle/     bootstrap, graceful shutdown, supervisor hooks
  safety/        ReadOnlyGuard (intercepts api gateway, blocks non-GET)
  resume/        snapshot loader, seq cursor
  index.ts       wires Context to existing TUI / WS / API
db/migrations/   node-pg-migrate SQL
docker-compose.yml   Postgres 16 service only
```

## Components

### config/
`zod` schema. Loads `.env` via `dotenv`.

Required:
- `PG_URL` (e.g. `postgres://bot:bot@localhost:5432/coindcx_bot`)
- `COINDCX_API_KEY`, `COINDCX_API_SECRET`
- `LOG_DIR`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Optional with defaults:
- `LOG_LEVEL=info`
- `LOG_FILE_ROTATE_MB=50`
- `LOG_FILE_KEEP=10`
- `SIGNAL_SINKS=stdout,file,telegram` (comma list)
- `SHUTDOWN_GRACE_MS=5000`
- `AUDIT_BUFFER_MAX=10000`

Behaviour:
- Fail-fast on any parse error.
- Custom redactor: any object key matching `/secret|token|key|password/i` is replaced with `***` before logging.

### logging/
`pino` with multistream:
- stdout (JSON, level configurable)
- rotating file `${LOG_DIR}/bot-YYYYMMDD.log` via `pino-roll`, size + count limits from config

Child loggers per module: `logger.child({ mod: 'ws' })`. Redaction wired through pino's `redact` option using the same key list as the config redactor.

### db/
- `pg` pool (singleton via `getPool()`).
- Migrations via `node-pg-migrate`, run on boot, idempotent.

Initial migration creates:

```sql
CREATE TABLE audit_events (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  kind      text NOT NULL,        -- 'signal' | 'alert' | 'order_state' | 'reconcile_diff' | 'read_only_violation' | 'ws_reconnect' | ...
  source    text NOT NULL,        -- module that emitted (e.g. 'ws','api','strategy:foo')
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
  severity  text NOT NULL,        -- 'info' | 'warn' | 'critical'
  payload   jsonb NOT NULL
);
CREATE INDEX signal_log_strategy_ts_idx ON signal_log (strategy, ts DESC);
CREATE INDEX signal_log_pair_ts_idx     ON signal_log (pair, ts DESC);
```

### audit/
`recordEvent(kind, source, seq, payload)`. Writes are async, errors logged but never thrown to caller (audit failures must not break trading-flow logic). Backed by an in-memory bounded queue (`AUDIT_BUFFER_MAX`) drained by a background writer; if Postgres is unreachable, queue fills, then drops oldest with a `dropped_count` metric in the log.

### signals/SignalBus
```ts
type Signal = {
  id: string;             // ulid
  ts: string;             // ISO
  strategy: string;
  type: string;           // 'entry_long' | 'exit' | 'risk_breach' | ...
  pair?: string;
  severity: 'info' | 'warn' | 'critical';
  payload: Record<string, unknown>;
};
```

`bus.emit(signal)` writes to `signal_log` and fan-outs to enabled sinks in parallel. Per-sink errors are isolated; one failing sink never blocks others.

### sinks/
Interface: `{ name: string; emit(signal: Signal): Promise<void> }`.

Implementations:
- `StdoutSink` — single JSON line per signal.
- `FileSink` — append-only JSONL, file path `${LOG_DIR}/signals-YYYYMMDD.jsonl`, daily rollover.
- `TelegramSink` — `POST https://api.telegram.org/bot<token>/sendMessage`. Token-bucket rate limit (20/min, configurable). Markdown body. Retry 3× with exponential backoff (250ms / 1s / 4s). On persistent failure: log error + `audit.recordEvent('telegram_drop', ...)` and move on.

### lifecycle/
`bootstrap()`:
1. Validate config (fail-fast → exit 1)
2. Init logger
3. Connect pg pool (retry 5×, 1/2/4/8/16s); on final failure exit 1
4. Run migrations (idempotent)
5. Load resume cursors into memory
6. Init SignalBus + enabled sinks
7. Return `Context { config, logger, pool, bus, cursors, guard }`

`shutdown(signal)` on `SIGINT`/`SIGTERM`:
- Stop new WS message handling
- Drain in-flight sink emits (deadline = `SHUTDOWN_GRACE_MS`)
- Flush audit queue
- Close pg pool
- Exit 0

`unhandledRejection` / `uncaughtException`:
- Log + audit `kind='fatal'`
- Exit 1 (supervisor / systemd / nodemon restarts)

### safety/ReadOnlyGuard
Wraps the existing axios instance in `gateways/coindcx-api.ts`. Axios request interceptor:
- If `method ∈ {POST, PUT, PATCH, DELETE}` → throw `ReadOnlyViolation`
- If path matches deny-list regex (e.g. `/orders/create`, `/orders/cancel`, `/orders/edit`, `/exchange/v1/funds/transfer`) → throw `ReadOnlyViolation` even if method is GET (defence in depth)
- On violation: emit `audit.recordEvent('read_only_violation', source, null, {method, path})` and `bus.emit({severity:'critical', type:'read_only_violation', ...})` then throw

Allowlist of GET endpoints maintained explicitly. New endpoints must be added to the allowlist before use; unknown paths log a warning but pass.

### resume/
`getCursor(stream)` / `setCursor(stream, seq, ts)`. F2/F3 will use to detect WS sequence gaps and decide replay; F1 just provides the storage and in-memory cache.

## Data Flow

```
.env ─► config (zod) ─► bootstrap ─► Context { logger, pool, bus, cursors, guard }
                                            │
                                            ▼
                              existing gateways (ws + api)
                              wrapped via ReadOnlyGuard
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  ▼                         ▼                         ▼
           audit.recordEvent          signalBus.emit            cursors.set
            → audit_events           → sinks (stdout/             → seq_cursor
                                       file/telegram)
                                     → signal_log
```

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| Config invalid | exit 1 before side effects |
| DB unreachable on boot | retry 5× exponential backoff, then exit 1 |
| DB unreachable mid-run | buffer audit/signal writes (bounded `AUDIT_BUFFER_MAX`); on overflow drop oldest, log dropped count |
| Sink failure | per-sink retry policy; isolated; never blocks bus |
| `ReadOnlyViolation` | exception + audit + critical signal; process keeps running (caller bug, not exchange issue) |
| WS disconnect | existing reconnect logic preserved; each reconnect audited |
| Unhandled rejection / exception | log + audit + exit 1 |

## Testing

- `vitest` set up; `npm test` runs all.
- **Unit:** config parser (valid + invalid env), redactor, signal bus fan-out, each sink (stdout / file / telegram with `nock`) including retry + rate-limit, `ReadOnlyGuard` (every write verb blocked, allowlist works, deny-list overrides allowlist), audit buffer overflow path.
- **Integration:** real Postgres via `testcontainers`; migrations up/down; audit insert read-back; cursor round-trip; SignalBus → `signal_log` row visible.
- **CI:** `npm run check` = `tsc --noEmit && eslint . && vitest run`.

## Build Sequence (for implementation plan)

1. `tsconfig` strict + ESLint + Vitest scaffold
2. `config` + zod + redactor
3. `logging` (pino + pino-roll multistream + redact)
4. `db` pool + `node-pg-migrate` + first migration
5. `audit` module + tests
6. `SignalBus` + `StdoutSink` + `FileSink` + tests
7. `TelegramSink` + token-bucket rate limit + retries + tests (nock)
8. `ReadOnlyGuard` + tests
9. `resume` cursors module + tests
10. `lifecycle` bootstrap + shutdown
11. Rewire existing `src/index.ts` through new `Context`
12. `docker-compose.yml` (Postgres 16 + named volume) + `.env.example`
13. README updates: required env vars, `npm run db:migrate`, `npm start`, `npm run check`

## Acceptance Criteria

- `npm start` boots, connects Postgres, runs migrations idempotently, logs JSON to stdout + file, opens the existing WS connection, audits each WS reconnect.
- Any code path attempting a non-GET CoinDCX call (or denied path) throws `ReadOnlyViolation` and writes an `audit_events` row with `kind='read_only_violation'`.
- Calling `bus.emit({...})` writes a row to `signal_log` and produces output in stdout, the daily JSONL file, and Telegram (verified end-to-end against a real bot in dev).
- `kill -TERM <pid>` triggers graceful shutdown within `SHUTDOWN_GRACE_MS`.
- `npm run check` is green (typecheck + lint + tests).

## References

- CoinDCX API docs: https://docs.coindcx.com/
- Existing source: `src/gateways/coindcx-api.ts`, `src/gateways/coindcx-ws.ts`, `src/index.ts`, `src/tui/app.ts`
- Roadmap: F2 (market data integrity) → F3 (account reconciler) → F4 (strategy/signal framework + backtester) → F5 (risk alert engine) → F6 (TUI v2 + metrics surface)
