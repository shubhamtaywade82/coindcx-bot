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

### Phase 3: Account state reconciler (shipped)
- Per-entity stores (positions, balances, orders) + fills ledger
- WS-first ingest with heartbeat-driven forced sweeps and 5-minute drift sweep
- Divergence detector with severity classification
- Audit changelog and full Postgres history (orders ↔ fills ↔ positions linkage)
- Lifecycle, threshold, and divergence signals on the SignalBus
- Read-only forever — only signed-read endpoints used
- Probe: `npm run probe:account -- --duration N`

### Phase 4: Strategy framework + backtester (shipped)
- Pluggable Strategy interface with mixed cadence (interval / tick / bar_close)
- Per-pair instance isolation; auto-disable on error threshold
- RiskFilter passthrough boundary for F5
- Built-in strategies: SmcRule, MaCross, LlmPulse (wraps existing AiAnalyzer)
- Backtester reuses Strategy contract; CandleSource / PostgresFillSource / JsonlSource
- Standard metrics (Sharpe, max drawdown, profit factor, win rate) + per-trade CSV
- CLI: `npm run backtest -- --strategy <id> --pair <pair> --from <iso> --to <iso> --source candles --tf 15m`

## Setup

1. Copy env: `cp .env.example .env` and fill required values.
2. Start Postgres: `docker compose up -d`
3. Migrate: `npm run db:migrate`
4. Start: `npm start`

Probe live feeds: `npm run probe -- --pair B-SOL_USDT --duration 60`

## Live operation (read-only observer)

Bot is structurally read-only:
- `applyReadOnlyGuard` is wired unconditionally on every axios client (`src/gateways/coindcx-api.ts:9,15`). It rejects all write verbs and any deny-listed order/funds path. No code path bypasses it; `READ_ONLY` env is informational only.
- No call sites for `orders/create|cancel|positions/exit` exist anywhere in `src/`. Verify before any release: `grep -rn "orders/create\|orders/cancel\|positions/exit" src/`.

Run under pm2 supervisor for autorestart + log rotation:

```
npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs coindcx-bot
pm2 save
pm2 startup        # generate boot script (run command it prints)
```

Alert pipeline:
- `Telegram` sink delivers `severity:'critical'` and `severity:'warn'` for `strategy:'integrity'` (covers `stale_feed`, `book_resync`, `book_resync_failed`, `heartbeat_lost`, `clock_skew`).
- Rate-limited via `TELEGRAM_RATE_PER_MIN` (default 20/min).
- Drops are logged + audit-recorded; check `logs/` for delivery failures.

Optional Pine/TradingView webhook gateway (off by default):

```
WEBHOOK_ENABLED=true
WEBHOOK_BIND_HOST=127.0.0.1            # default; expose only via reverse proxy
WEBHOOK_PORT=4003
WEBHOOK_PATH=/webhook/tradingview
WEBHOOK_SHARED_SECRET=<long random>    # required if exposed beyond loopback
```

POST raw alert text to `http://<host>:<port>/webhook/tradingview` with `X-Auth-Token: <secret>` (or `?token=<secret>`). Body capped at 64 KiB. Parsed alerts emit on `SignalBus`. Endpoint never places orders — receive-only.

Pre-flight checklist before going live:
1. `npm run check` clean (typecheck + lint + tests)
2. `READ_ONLY=true` in env (defense-in-depth, even though guard ignores it)
3. `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set; send a test signal to verify delivery
4. `pm2 logs` shows `boot complete` with expected sinks
5. TUI header reads `MODE: MONITOR`, `ORDER: OFF`

## Quality gate

`npm run check` — typecheck + lint + tests. Some integration tests require Docker (skip with `SKIP_DOCKER_TESTS=1`).

### Phase 5: Risk-alert engine (shipped)
- `CompositeRiskFilter` chains pluggable rules
- Built-in rules: MinConfidence, MaxConcurrentSignals, PerStrategyMaxPositions, DrawdownGate, OpposingPairCorrelation, PerPairCooldown
- Live-signal tracking with TTL expiry
- Blocks emit `risk.blocked` signals with rule reasons (`RISK_ALERT_EMIT=true`)
- Mode switch: `RISK_FILTER_MODE=composite|passthrough`

### Phase 6: TUI v2 (current)
- New panels: `Signals` (recent strategy.long/short/wait/error/disabled), `Risk` (live count, drawdown peak, recent risk.blocked rules)
- Bus observer auto-feeds new panels (taps `SignalBus.emit`)
- Help overlay (`?`) lists all keybindings
- Focus shortcuts: `s` signals, `r` risk, `p` positions, `b` balances
- Multi-pair tabs with per-pair AI/book caching and signal-count badges
- Layout reorg: 4-col main row (book | AI | positions | signals); 3-col bottom row (balances | orders | risk)

## Roadmap

- Original read-only phases (F1–F6) shipped.
- Forward roadmap for retail-safe automated futures trading: `docs/institutional-retail-trading-roadmap.md`.
- Live trading readiness, canary rules, and safety gates are documented in the roadmap's "When Can This Go Live?" section.

See `docs/superpowers/specs/` for design specs and `docs/superpowers/plans/` for implementation plans.
