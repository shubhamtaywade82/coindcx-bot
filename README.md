# coindcx-bot

Read-only institutional-grade observation + signal-emitter bot for CoinDCX. **Never places, cancels, or modifies orders.** A `ReadOnlyGuard` axios interceptor enforces this in code by blocking write verbs and any path on the order/funds-transfer deny-list.

## Phase 1 (current): Reliability & Observability Foundation

- Validated config (zod) with secret redaction
- Pino logging (stdout JSON + rotating file)
- Postgres persistence (audit, signal log, resume cursors)
- Pluggable signal sinks (stdout / JSONL file / Telegram)
- ReadOnlyGuard with signed-read POST allowlist
- Graceful shutdown, hybrid crash-resume

## Setup

1. Copy env: `cp .env.example .env` and fill required values.
2. Start Postgres: `docker compose up -d`
3. Migrate: `npm run db:migrate`
4. Start: `npm start`

## Quality gate

`npm run check` — typecheck + lint + tests. Some integration tests require Docker (skip with `SKIP_DOCKER_TESTS=1`).

## Roadmap

- F2: market data integrity (L2 OB, gap detection, latency)
- F3: account state reconciler
- F4: strategy/signal framework + backtester
- F5: risk-alert engine
- F6: TUI v2 + Prometheus metrics

See `docs/superpowers/specs/` for design specs and `docs/superpowers/plans/` for implementation plans.
