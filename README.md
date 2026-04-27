# coindcx-bot

Read-only institutional-grade observation + signal-emitter bot for CoinDCX. **Never places, cancels, or modifies orders.** A `ReadOnlyGuard` axios interceptor enforces this in code by blocking write verbs and any path on the order/funds-transfer deny-list.

## Phases

### Phase 1: Reliability foundation (shipped)
- Validated config (zod), pino logging, Postgres persistence
- Pluggable signal sinks (stdout / JSONL / Telegram)
- ReadOnlyGuard with signed-read POST allowlist
- Graceful shutdown, hybrid crash-resume

### Phase 2: Market data integrity (shipped)
- L2 OrderBook with checksum + state machine
- BookManager + ResyncOrchestrator (WS-first, REST fallback under token-bucket)
- Heartbeat watchdog, StaleWatcher (hybrid floor + 3×p99 threshold)
- Latency histograms (ws-rtt + tick-age, p50/p95/p99)
- Time-sync (exchange + NTP, critical alarm on |skew| > threshold)
- Always-on TailBuffer; `npm run probe -- --pair X --duration N` for raw frame capture

### Phase 3: Account state reconciler (current)
- Per-entity stores (positions, balances, orders) + fills ledger
- WS-first ingest with heartbeat-driven forced sweeps and 5-minute drift sweep
- Divergence detector with severity classification
- Audit changelog and full Postgres history (orders ↔ fills ↔ positions linkage)
- Lifecycle, threshold, and divergence signals on the SignalBus
- Read-only forever — only signed-read endpoints used
- Probe: `npm run probe:account -- --duration N`

## Setup

1. Copy env: `cp .env.example .env` and fill required values.
2. Start Postgres: `docker compose up -d`
3. Migrate: `npm run db:migrate`
4. Start: `npm start`

Probe live feeds: `npm run probe -- --pair B-SOL_USDT --duration 60`

## Quality gate

`npm run check` — typecheck + lint + tests. Some integration tests require Docker (skip with `SKIP_DOCKER_TESTS=1`).

## Roadmap

- F4: strategy/signal framework + backtester
- F5: risk-alert engine
- F6: TUI v2 + Prometheus metrics

See `docs/superpowers/specs/` for design specs and `docs/superpowers/plans/` for implementation plans.
