# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Overview

`coindcx-bot` is a **read-only** institutional-grade market observation and signal-emission bot for CoinDCX futures. It never places, cancels, or modifies orders. A `ReadOnlyGuard` axios interceptor enforces this unconditionally on every HTTP client — `READ_ONLY` env is defense-in-depth only.

Before any release, verify no write endpoints are called:
```
grep -rn "orders/create\|orders/cancel\|positions/exit" src/
```

## Commands

```bash
# Full quality gate (typecheck + lint + tests)
npm run check

# Individual steps
npm run typecheck
npm run lint
npm run test

# Run a single test file
npx vitest run tests/path/to/file.test.ts

# Run tests in watch mode
npm run test:watch

# Development (hot-reload)
npm run dev

# Database
npm run db:migrate      # run pending migrations (up)
npm run db:rollback     # roll back one migration

# CLI tools
npm run probe -- --pair B-SOL_USDT --duration 60      # raw WS frame capture
npm run probe:account -- --duration 60                  # account state probe
npm run sidecar:ws                                       # WS-only transport sidecar
npm run backtest -- --strategy smc.rule.v1 --pair B-SOL_USDT --from 2024-01-01 --to 2024-03-01 --source candles --tf 15m
npm run backtest:candles                                 # fetch + store candle history
npm run backtest:record-microstructure                   # record orderbook microstructure

# Environment
cp .env.example .env     # fill required values
npm run verify:env        # pre-flight env check

# Production (pm2)
pm2 start ecosystem.config.js
pm2 logs coindcx-bot
```

**Docker (Postgres only):** `docker compose up -d` — exposes port 5433 → internal 5432. Default URL: `postgres://bot:bot@localhost:5433/coindcx_bot`.

## Test Environment

Tests run without Docker (`SKIP_DOCKER_TESTS=1` is auto-set via `tests/setup-env.ts`). Safe defaults are injected for missing env vars (`PG_URL`, `COINDCX_API_KEY`, `COINDCX_API_SECRET`, `LOG_DIR`). Integration tests that require a live Postgres container check `SKIP_DOCKER_TESTS` and skip if set.

## Architecture

### Boot Sequence (`src/lifecycle/`)

`bootstrap()` → loads zod-validated config → pino logger → Postgres pool with retry → migrations → Cursors (resume state) → Audit → SignalBus (with Sinks) → AiAnalyzer + MarketStateBuilder → optional WebhookGateway → MarketCatalog → CoreRuntimePipeline → returns `Context`.

`Context` (`src/lifecycle/context.ts`) is the single shared object passed through the entire app. `src/index.ts` calls `bootstrap()`, then wires all subsystems together in `runApp()`.

### Signal Flow

```
WS/Webhook → StrategyController → RiskFilter → SignalBus.emit()
                                                    ↓
                                         [Sinks: file, telegram, stdout]
                                         [Postgres: signal_log table]
                                         [TUI observer]
                                         [RuntimePipeline: confluence → risk → tradePlan → route]
```

Every `Signal` has `{ id, ts, strategy, type, pair, severity, payload }`. Types follow `strategy.long`, `strategy.short`, `strategy.wait`, `risk.blocked`, `account.*`, `integrity.*`.

### Key Subsystems

**`src/gateways/`** — CoinDCX transport layer.
- `CoinDCXWs`: socket.io-client **pinned to v2.4.0** (must not change). Emits typed events: `depth-snapshot`, `depth-update`, `new-trade`, `currentPrices@futures#update`, `candlestick`, `df-position-update`, `df-order-update`, `df-trade-update`, `balance-update`.
- `CoinDCXApi`: signed REST calls (canonical JSON + HMAC-SHA256). Both axios instances have `ReadOnlyGuard` applied.
- `futures-endpoint-resolver`: resolves paths from `config/coindcx_futures_endpoints.yml` — always use this, never hardcode paths.

**`src/marketdata/`** — Market data integrity.
- `IntegrityController`: orchestrates book management, heartbeat, stale-feed detection, latency histograms, time-sync, and TailBuffer (raw frame capture).
- `BookManager` + `OrderBook`: L2 order book with sequence-number gap detection, checksum validation, and WS-first resync with REST fallback under token bucket.
- `CoinDcxFusion`: merges L2 book + MTF candles + trade flow into a `FusionSnapshot` per pair (microstructure metrics, intraday indicators, swing indicators).
- `MultiTimeframeStore`: candle store for 1m/15m/1h (seeds from REST, updated via WS `candlestick`).

**`src/account/`** — Account state reconciler (F3).
- `AccountReconcileController`: per-entity stores (positions, balances, orders) + fills ledger. WS-first with heartbeat-driven forced sweeps and 5-minute drift sweeps. `ingest(entity, raw)` is the entry point for WS events.
- `DivergenceDetector`: classifies severity of position/balance drift between WS and REST snapshots.
- All data normalised through `normalizers.ts` before entering stores.

**`src/strategy/`** — Strategy framework (F4).
- `Strategy` interface: `manifest` (id, mode, pairs, intervalMs/tickChannels/barTimeframes) + `evaluate(ctx)` → `StrategySignal | null`.
- Three trigger modes: `interval` (timer), `tick` (WS event), `bar_close` (candle close).
- `StrategyController`: registers strategies, wires to drivers (IntervalDriver, TickDriver, BarDriver), applies RiskFilter, emits via SignalBus.
- Built-in strategies: `SmcRule` (deterministic SMC: HTF/LTF alignment + BOS + displacement + FVG), `MaCross`, `LlmPulse` (wraps AiAnalyzer/Ollama), `BearishSmc`.
- `StrategyRegistry`: tracks per-pair strategy instances; auto-disables on error threshold.

**`src/strategy/risk/`** — Risk filter chain (F5).
- `CompositeRiskFilter` chains pluggable `RiskRule[]`: `MinConfidence`, `MaxConcurrentSignals`, `PerStrategyMaxPositions`, `DrawdownGate`, `OpposingPairCorrelation`, `PerPairCooldown`.
- Controlled by `RISK_FILTER_MODE=composite|passthrough`.
- Blocked signals emit `risk.blocked` when `RISK_ALERT_EMIT=true`.

**`src/runtime/`** — Core runtime pipeline (F5/F6).
- `CoreRuntimePipeline.process(signal, context)` runs: SignalEngine → RegimeClassifier → ConfluenceScorer → TradePlanEngine → RiskManager → OrderRouter → PositionStateMachine.
- All modules are injected and individually testable.
- `RuntimeWorkerSet`: candle-close worker, breakeven-protection worker, funding-window worker.

**`src/signals/bus.ts`** — `SignalBus.emit()` persists to `signal_log` and fans out to all sinks concurrently.

**`src/sinks/`** — Signal delivery: `FileSink` (JSONL), `TelegramSink` (rate-limited via token bucket), `StdoutSink`. Telegram delivers `severity:'critical'` and `severity:'warn'` for `strategy:'integrity'` events.

**`src/persistence/`** — Postgres persistence for signals, trades, orderbook artifacts, runtime state (paper trades).

**`src/sidecar/`** — Transport-only WS sidecar (`npm run sidecar:ws`). Normalizes exchange events and publishes to Redis Streams (`sidecar:<stream>:<pair>`). No strategy logic.

**`src/tui/`** — Terminal UI (`blessed`). Panels: order book, AI/pulse, positions, signals, risk, balances, orders. Multi-pair tabs with signal-count badges. TUI is wired after `bootstrap()` in `runApp()`.

### Config (`src/config/schema.ts`)

All config is zod-validated from env at startup. Required: `PG_URL`, `COINDCX_API_KEY`, `COINDCX_API_SECRET`, `LOG_DIR`. All other values have defaults. Key groupings by phase: F2 market integrity, F3 account reconciler, F4 strategy, F5 risk, B2 workers, B5 trade plan.

### Database

`node-pg-migrate` with migrations in `src/db/migrations/`. Run `npm run db:migrate` at startup or manually. `getPool()` (`src/db/pool.ts`) is the singleton pg pool.

## Non-Negotiable Constraints (from AGENT.md)

- **`socket.io-client` must stay pinned at `2.4.0`** — CoinDCX WS requires this exact version.
- **Auth signing**: canonical JSON body → HMAC-SHA256 with `COINDCX_API_SECRET`.
- **Futures endpoints** must come from `config/coindcx_futures_endpoints.yml` via `futures-endpoint-resolver`, not hardcoded paths.
- **Hard leverage cap**: 10x (`TRADEPLAN_HARD_MAX_LEVERAGE`).
- **Liquidation safety**: `liq distance >= 2× stop distance` (`TRADEPLAN_LIQUIDATION_BUFFER_MULTIPLIER`).
- **No negative close policy** (`src/runtime/negative-close-policy.ts`): only `time_stop_kill` exception path is allowed, must emit a `risk.time_stop_kill` signal.

## Development Workflow

- `TODO.md` is the master execution checklist; work must be tracked there.
- Implement one checklist slice at a time with tests before marking done.
- Keep PR scope small; do not batch unrelated slices.
- New strategies: implement `Strategy` interface, register in `src/index.ts` behind `STRATEGY_ENABLED_IDS` check.
- New risk rules: implement `RiskRule` interface in `src/strategy/risk/rules/`, add to `CompositeRiskFilter` in `src/index.ts`.
- New migrations: add a file in `src/db/migrations/` with a numeric timestamp prefix.
