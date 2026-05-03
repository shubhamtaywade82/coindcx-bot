# TODO

Master checklist for:
- Existing repo plans (F1-F4 + roadmap slices)
- Uploaded framework document:
  `CoinDCX Spot and Perpetual Trading Bot - Institutional-Grade Signal and Execution Framework`

Use this file as the single source of truth for execution tracking.

## A) Existing Plan Execution (F1-F4)

### A1. NOW (Critical Path)

- [ ] PR-01 Foundation tooling baseline
  - [ ] F1 Task 1 (strict TypeScript, ESLint, Vitest, scripts, sanity test)
  - [ ] Verify quality gate passes with expected baseline output

- [ ] PR-02 Config and logging core
  - [ ] F1 Task 2 (config schema + redactor)
  - [ ] F1 Task 3 (logger)
  - [ ] Verify schema parsing, redaction, and structured log tests

- [ ] PR-03 Database bootstrap
  - [ ] F1 Task 4 (pool + migrations + initial schema)
  - [ ] F1 Task 13 infra portion (docker-compose postgres)
  - [ ] Verify migrations run end-to-end locally

- [ ] PR-04 Signal plumbing
  - [ ] F1 Task 5 (audit module)
  - [ ] F1 Task 6 (SignalBus + StdoutSink + FileSink)
  - [ ] Verify bounded queue behavior and sink outputs

- [ ] PR-05 Safety controls
  - [ ] F1 Task 7 (Telegram sink with token bucket and retries)
  - [ ] F1 Task 8 (ReadOnlyGuard)
  - [ ] F1 Task 11 (wire guard into gateway)
  - [ ] Verify blocked-write and allowed-read behavior

- [ ] PR-06 Runtime lifecycle
  - [ ] F1 Task 9 (resume cursors)
  - [ ] F1 Task 10 (bootstrap + shutdown + context)
  - [ ] F1 Task 12 (entrypoint wiring)
  - [ ] F1 Task 13 docs portion
  - [ ] Verify startup, steady-state, and graceful shutdown

### A2. NEXT (Core Product Capabilities)

- [ ] PR-07 Market data base contracts (F2 Tasks 1-3)
- [ ] PR-08 Book integrity engine (F2 Tasks 4-7)
- [ ] PR-09 Market health monitoring (F2 Tasks 8-11 + 13)
- [ ] PR-10 Market controller integration (F2 Tasks 12 + 14 + 15)
- [ ] PR-11 Account reconciler foundations (F3 Tasks 1-7)
- [ ] PR-12 Reconciliation safety logic (F3 Tasks 8-11 + 13)
- [ ] PR-13 Reconcile orchestration (F3 Tasks 12 + 14-18)
- [ ] PR-14 Account-state hardening (F3 Tasks 19-20)

### A3. LATER (Strategy + Backtesting + Execution Rollout)

- [ ] PR-15 Strategy framework skeleton (F4 Tasks 1-6)
- [ ] PR-16 Strategy drivers (F4 Tasks 7-9 + 13 + 14)
- [ ] PR-17 Built-in strategies (F4 Tasks 10-12)
- [ ] PR-18 Backtest data sources (F4 Tasks 15-18)
- [ ] PR-19 Backtest execution engine (F4 Tasks 19-22)
- [ ] PR-20 Backtest verification (F4 Tasks 23-24)

### A4. Roadmap Execution Slices

- [ ] PR-21 Slice 1 runtime wiring (signals -> intents, execution off by default)
- [ ] PR-22 Slice 2 risk sizing (`RiskSizer` + risk budget)
- [ ] PR-23 Slice 3 paper execution (`PaperExecutionEngine`)
- [ ] PR-24 Slice 4 order lifecycle persistence
- [ ] PR-25 Slice 5 TUI execution panels
- [ ] PR-26 Slice 6 backtest execution model upgrade
- [ ] PR-27 Slice 7 live adapter behind strict safety gates
- [ ] PR-28 Slice 8 live canary controls

## B) PDF Complete Coverage Checklist

### B1. Exchange Surface and Protocol Requirements

- [ ] Pin websocket client implementation to `socket.io-client@2.4.0` only
  - [x] Add lock in package manifest
  - [x] Add startup assertion that fails if version drifts
  - [x] Add regression test for handshake + event receipt

- [ ] Enforce CoinDCX auth contract for all private REST/private WS joins
  - [ ] `X-AUTH-APIKEY`
  - [ ] `X-AUTH-SIGNATURE` using HMAC-SHA256(secret, canonical JSON body)
  - [ ] `timestamp` in body
  - [x] Canonical JSON serialization validation tests
  - [x] Clock-skew handling and retry guard

- [ ] Build and persist `MarketCatalog` from `/exchange/v1/markets_details`
  - [x] Cache `pair <-> symbol <-> ecode <-> precision <-> step <-> min_notional <-> max_leverage`
  - [x] Add refresh job and stale-data alert

- [ ] Implement Spot REST wrappers and smoke tests
  - [x] Public data: ticker, markets, markets_details, trade_history, orderbook, candles
  - [x] Account/trading (read-only subset): balances, user info, status, status_multiple, active_orders, active_orders_count
  - [ ] Account/trading (write endpoint remains blocked by ReadOnlyGuard): create
  - [x] History (read-only subset): trade_history
  - [ ] Cancel/edit (write endpoints remain blocked by ReadOnlyGuard): cancel, cancel_all, cancel_by_ids, edit
- [ ] Wallet:
  - [ ] transfer implementation remains blocked by ReadOnlyGuard
  - [ ] sub_account_transfer implementation remains blocked by ReadOnlyGuard
  - [x] deny-list policy tests cover wallet transfer write routes
  - [x] Optional product surfaces (read-only fetch subset): margin/funding fetch endpoints
  - [ ] Optional product surfaces (write subset remains blocked): margin create/exit/edit, lend/settle
- [x] Enforce documented rate limits (especially `cancel_all` 30/60s)

- [ ] Futures REST endpoint capture and hardening
- [ ] Manually extract exact `/exchange/v1/derivatives/futures/...` paths from authenticated docs
- [x] Save verbatim paths + params to `config/coindcx_futures_endpoints.yml` (scaffold + validator in place; awaiting manual endpoint fill)
  - [x] Reject third-party gists as source of truth (validator enforces trusted docs host + blocks gist/snippet URLs)
  - [ ] Implement wrappers for all named futures sections:
    - [x] instruments active/details/realtime trades/orderbook/candles (resolver + loader scaffold in place; read-only methods now mapped with fallback)
    - [x] orders list/create/cancel/edit (list/read path wired via resolver; write paths remain blocked by ReadOnlyGuard)
    - [x] positions list/get/update leverage (list/get read path wired via resolver; update remains blocked)
    - [x] add/remove margin (wrappers added; write endpoints remain blocked by ReadOnlyGuard)
    - [x] cancel-all variants + exit position (wrappers added; write endpoints remain blocked by ReadOnlyGuard)
    - [x] TP/SL order create (`untriggered` status support; write endpoint remains blocked by ReadOnlyGuard)
    - [x] transactions/trades/current prices/pair stats (read wrappers mapped via futures resolver)
    - [x] cross margin details (read wrapper mapped via futures resolver)
    - [x] wallet transfer/details/transactions (details + transactions read wrappers mapped; transfer wrapper added and blocked by ReadOnlyGuard)
    - [x] change margin type (wrapper added; write endpoint remains blocked by ReadOnlyGuard)
    - [x] currency conversion (read wrapper mapped via futures resolver)

- [ ] Spot websocket channels and handlers
  - [ ] Private: `balance-update`, `order-update`, `trade-update` on `coindcx`
  - [ ] Public: candlestick, depth-snapshot, depth-update, currentPrices, priceStats, new-trade, price-change
  - [ ] Join/leave multiplexing support

- [ ] Futures websocket coverage
  - [ ] Confirm exact futures channel strings in authenticated docs body
  - [ ] Implement account/position/order/balance/candlestick/orderbook/current prices/new trade/LTP handlers
  - [ ] Add channel mapping docs with examples

- [ ] Explicit data-gap strategy for missing public endpoints/streams
  - [ ] No dedicated mark-price endpoint: use last price policy
  - [ ] No dedicated funding-rate endpoint: implement synthetic basis-derived estimate
  - [ ] Open interest field absence: treat as optional input with fallback
  - [ ] Liquidation price not guaranteed in docs: capture opportunistically from positions

### B2. Architecture and Runtime Topology

- [ ] Implement Node websocket sidecar (transport only, no strategy logic)
  - [ ] Normalize events
  - [ ] Publish to Redis Streams (`market.*`, `account.*`)
  - [ ] Reconnect and resubscribe all channels on disconnect

- [ ] Core runtime modules present and wired
  - [ ] SignalEngine
  - [ ] RegimeClassifier
  - [ ] ConfluenceScorer
  - [ ] RiskManager
  - [ ] OrderRouter
  - [ ] PositionStateMachine

- [ ] Worker/scheduler responsibilities
  - [ ] Candle-close jobs
  - [ ] Breakeven-protection ticker
  - [ ] Funding ticker before scheduled funding windows

- [ ] Persistence model implemented
  - [ ] `signals`, `trades`, `positions`, `risk_events`
  - [ ] orderbook snapshots and replay artifacts

### B3. Signal Component Catalog (all layers)

- [ ] Layer 1 Microstructure indicators
  - [ ] Top-N book imbalance
  - [ ] CVD (using maker/aggressor semantics)
  - [ ] Tape-speed acceleration
  - [ ] Aggressor ratio
  - [ ] Sweep detection (`<= 200ms` burst cluster)
  - [ ] Iceberg/spoof persistence heuristics

- [ ] Layer 2 Intraday indicators (1m-15m)
  - [ ] Anchored VWAP contexts (session/daily/swing)
  - [ ] TTM squeeze detection and breakout trigger
  - [ ] EMA stack (9/21/50) rule set
  - [ ] RSI divergence detector
  - [ ] ATR percentile rank over 200 bars
  - [ ] Rolling order-flow imbalance

- [ ] Layer 3 Swing indicators (1H-4H-1D)
  - [ ] Market structure shift (fractal swing based)
  - [ ] Daily/weekly pivots
  - [ ] 200/50 EMA bias filter
  - [ ] Funding-rate extremes as optional signal
  - [ ] OI delta vs price truth-table
  - [ ] Spot-futures basis signal
  - [ ] BTC dominance/correlation filter for alts

### B4. Regime Classifier and Confluence Scoring

- [ ] Regime classifier runs every 5 minutes (or each 5m close)
  - [ ] Inputs: ADX_4H, ATR_PCTL, BB_WIDTH_PCTL, MSS_4H
  - [ ] States: Trending, Ranging, Volatile, Compressed
  - [ ] Apply explicit threshold table from document
  - [ ] Tie-break order: Trending > Compressed > Ranging > Volatile
  - [ ] Regime change cancels pending entries

- [ ] Confluence scoring implementation
  - [ ] Maintain independent `long_score` and `short_score` in [0, 100]
  - [ ] Use regime-dependent component weights exactly as documented
  - [ ] Component contribution model: value in [-1, +1] mapped to side score
  - [ ] Trade-fire gate:
    - [ ] `max(score) >= 75`
    - [ ] `abs(long_score - short_score) >= 25`
    - [ ] Volatile regime exception only when microstructure contribution meets threshold

- [ ] Probability-of-profit analytics
  - [ ] SQL view grouped by `(regime, score_bucket_5)` over recent signal history
  - [ ] Output `p_hit_1r`, `p_hit_3r`, `p_hit_stop`, `expected_r`
  - [ ] Bayesian update using rolling recent trades (Beta prior update)
  - [ ] Attach probability block to each fired signal payload

### B5. Trade Plan, Risk, and Position Rules

- [ ] TradePlan compute path with hard constraints
  - [ ] Direction from score dominance
  - [ ] Structural invalidation stop with ATR buffer
  - [ ] Risk-capital based quantity + leverage cap
  - [ ] Hard leverage cap at 10x (regardless of venue max)
  - [ ] Liquidation buffer rule: distance to liq >= 2x stop distance
  - [ ] Targets: TP1 at 1R, TP2 at 3R, TP3 trailing by chandelier/HTF structure
  - [ ] Breakeven-plus includes fees and funding buffer

- [ ] "No close in negative PnL" policy operationalization
  - [ ] High-confluence gate
  - [ ] Asymmetric R management and BE lock behavior
  - [ ] Time-stop kill as only permitted negative close path
  - [ ] Log `risk_event: time_stop_kill`

### B6. Position State Machine and Idempotency

- [ ] Implement formal state machine
  - [ ] IDLE -> SCANNING -> SIGNAL_DETECTED -> ENTRY_VALIDATED -> ORDER_PLACED
  - [ ] POSITION_OPEN -> BREAKEVEN_PROTECTED -> PARTIAL_TP_HIT -> TRAILING -> POSITION_CLOSED
  - [ ] TIME_STOP_KILL side path

- [ ] Transition and reconciliation rules
  - [ ] Unfilled timeout cancellation path
  - [ ] Partial fill handling from `remaining_quantity`
  - [ ] Idempotency keying by `client_order_id + event_id`
  - [ ] Dedup unique index in Postgres
  - [ ] Restart reconciliation via active orders + positions snapshots

### B7. Database and Data Contracts

- [ ] Schema coverage from document essentials
  - [ ] `markets`
  - [ ] `candles`
  - [ ] `signals`
  - [ ] `trades`
  - [ ] `positions`
  - [ ] `risk_events`
  - [ ] `order_book_snapshots`

- [ ] Add indexes and constraints needed for replay/idempotency
- [ ] Keep payload columns JSONB where dynamic shape is expected
- [ ] Add migration and rollback verification tests

### B8. Backtesting and Validation

- [ ] Candle data ingestion
  - [ ] Use `/market_data/candles` with pagination and max 1000 bars/call
  - [ ] Persist multi-interval history

- [ ] High-fidelity microstructure replay
  - [ ] Run 30-day live depth/trade recorder
  - [ ] Persist raw events to durable storage (Parquet/S3 or equivalent)

- [ ] Event-driven simulator
  - [ ] Reuse production SignalEngine functions
  - [ ] Avoid vectorized shortcuts for orderbook logic

- [ ] Metrics set
  - [ ] Win rate, avg R, profit factor
  - [ ] Max drawdown, Calmar, Sharpe
  - [ ] Median time-to-1R
  - [ ] Percent reaching BE-lock before negative close (target >= 99%)

- [ ] Walk-forward validation
  - [ ] 6-month in-sample + 1-month out-of-sample rolling windows
  - [ ] Reject parameter set when OOS Sharpe < 0.5x IS Sharpe

- [ ] Paper trade gate before live
  - [ ] Dry-run router writes to `paper_trades`
  - [ ] Run minimum 30 calendar days
  - [ ] Enforce go-live criteria from recommendations

### B9. CoinDCX-Specific Operational Gotchas

- [ ] Symbol/pair resolver used everywhere (no mixed semantics)
- [ ] `cancel_all` used sparingly and rate-limit aware
- [ ] Funding windows scheduler at 09:30 / 17:30 / 01:30 IST with pre-event recompute
- [ ] WS disconnect handling:
  - [ ] If WS gap > 5s, emit `risk_event`
  - [ ] Pause new entries until next clean candle
  - [ ] Reconcile state immediately after reconnect
- [ ] Low-liquidity guardrails:
  - [ ] Notional floor for thin pairs
  - [ ] Top-of-book depth multiple vs intended notional
- [ ] Mark price equals last price policy reflected in risk constraints
- [ ] Synthetic funding approximation implemented and reconciled daily to UI values

### B10. Stage-Based Rollout and Runtime Controls

- [ ] Stage 0 Foundations
  - [ ] Sidecar + Redis Streams verified on public channels
  - [ ] MarketCatalog built
  - [ ] HMAC signer smoke-tested
  - [ ] Futures endpoint YAML captured and versioned

- [ ] Stage 1 Read-only data plane
  - [ ] Stream/persist top USDT and INR pairs across required intervals
  - [ ] Orderbook snapshot+delta merge with `vs` gap recovery
  - [ ] 30-day recorder running continuously

- [ ] Stage 2 Signal + paper trading
  - [ ] Layer 2 + Layer 3 first, then Layer 1 integration
  - [ ] Regime + confluence emit signals with full components
  - [ ] Paper run meets:
    - [ ] >= 99% BE-lock before stop
    - [ ] expectancy >= +0.4R
    - [ ] max drawdown < 8%

- [ ] Stage 3 Live gated capital
  - [ ] Start with 0.25% risk and 3x leverage cap for first 30 trades
  - [ ] Promote to 0.5% risk and 10x cap only after gate pass
  - [ ] Operator kill-switch wired and tested
  - [ ] Threshold policies implemented:
    - [ ] escalate at high rolling expectancy + BE compliance
    - [ ] de-escalate/disable on BE compliance degradation
    - [ ] constrain to Trending-only entries when rolling Sharpe degrades

### B11. Security, Compliance, and Incident-Readiness

- [ ] API keys IP-bound and withdrawal safeguards documented
- [ ] Keep futures wallet balances near working capital only
- [ ] Export-ready trade logs for tax/compliance workflows
- [ ] Retention policy and auditability controls documented
- [ ] Incident playbook for exchange/API disruptions documented and tested

## C) Definition of Done for Any Checklist Item

- [ ] Code/tests/docs updated
- [ ] Behavior verified with explicit test or smoke command
- [ ] Checklist item and sub-items checked only after verification evidence exists
- [ ] PR description links the completed checklist scope

## D) PDF -> TODO Traceability Matrix

Use this matrix to verify every requirement from the uploaded framework document has
an execution home in this checklist.

| PDF section | Requirement focus | Covered in TODO |
| --- | --- | --- |
| TL;DR | Confluence-gated state machine, 10x cap, liq-buffer rule, architecture split, data gaps | B2, B4, B5, B6, B9, B10 |
| A. CoinDCX API reference (A1-A5) | Auth, spot/futures REST, sockets, known endpoint/stream gaps | B1, B9, B10 |
| B. Signal component catalog | Layer 1/2/3 signal modules and formulas | B3 |
| C. Regime classifier | 4-state regime model + thresholds + cadence | B4 |
| D. Confluence scoring engine | Regime weights, fire conditions, score conflict guard | B4 |
| E. Entry/stop/target/sizing | TradePlan computation, R-based exits, leverage/liq/BE constraints | B5 |
| F. "No negative close" state machine | Lifecycle states, BE lock, time-stop kill path | B5, B6 |
| G. Implementation architecture | Sidecar, streams, runtime modules, workers, storage responsibilities | B2, B7 |
| H. Database schema essentials | Markets/candles/signals/trades/positions/risk events/orderbook schema | B7 |
| I. Backtesting and validation | Candle ingest, recorder, simulator, metrics, walk-forward, paper gate | B8, B10 |
| J. Probability-of-profit output schema | p_hit fields, expected_R, payload attachment | B4 |
| K. CoinDCX-specific gotchas | pair/symbol mapping, reconnect/rate limits/funding/liq semantics | B9, B11 |
| Recommendations (Stage 0-3) | Sequenced rollout and risk escalation/de-escalation controls | B10 |
| Caveats | Futures docs limits, missing fields/streams, platform and data-fidelity caveats | B1, B8, B9, B11 |

### Traceability verification checklist

- [ ] Every new PDF requirement is mapped to at least one B-section before implementation
- [ ] Any TODO item added during implementation includes its PDF section reference
- [ ] If a PDF claim is intentionally out-of-scope, record rationale in PR description
