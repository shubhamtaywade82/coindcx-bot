# TODO

## NOW (Critical Path)

- [ ] PR-01: Foundation tooling baseline
  - [ ] F1 Task 1: Tooling scaffold (tsconfig strict + ESLint + Vitest)

- [ ] PR-02: Config + logging core
  - [ ] F1 Task 2: Config schema + redactor
  - [ ] F1 Task 3: Logger (pino + multistream + redact)

- [ ] PR-03: Database bootstrap
  - [ ] F1 Task 4: Postgres pool + migrations + initial schema
  - [ ] F1 Task 13: docker-compose for Postgres (infrastructure portion)

- [ ] PR-04: Signal plumbing
  - [ ] F1 Task 5: Audit module with bounded queue
  - [ ] F1 Task 6: SignalBus + StdoutSink + FileSink

- [ ] PR-05: Safety controls
  - [ ] F1 Task 7: TelegramSink with token bucket + retries
  - [ ] F1 Task 8: ReadOnlyGuard
  - [ ] F1 Task 11: Wire ReadOnlyGuard into existing CoinDCX API gateway

- [ ] PR-06: Runtime lifecycle
  - [ ] F1 Task 9: Resume cursors
  - [ ] F1 Task 10: Lifecycle bootstrap + shutdown + Context
  - [ ] F1 Task 12: New entrypoint wires existing TUI/WS through Context
  - [ ] F1 Task 13: README updates (documentation portion)

## NEXT (Core Product Capabilities)

- [ ] PR-07: Market data base contracts
  - [ ] F2 Task 1: F2 config schema additions + dependencies
  - [ ] F2 Task 2: TailBuffer (always-on raw-frame ring)
  - [ ] F2 Task 3: Probe CLI

- [ ] PR-08: Book integrity engine
  - [ ] F2 Task 4: RestBudget (token bucket guarding REST resync)
  - [ ] F2 Task 5: OrderBook (apply, checksum, state)
  - [ ] F2 Task 6: BookManager
  - [ ] F2 Task 7: ResyncOrchestrator

- [ ] PR-09: Market health monitoring
  - [ ] F2 Task 8: Heartbeat watchdog
  - [ ] F2 Task 9: Latency tracker
  - [ ] F2 Task 10: Stale watcher
  - [ ] F2 Task 11: Time sync
  - [ ] F2 Task 13: TUI badge — real LAT from latency tracker

- [ ] PR-10: Market controller integration
  - [ ] F2 Task 12: IntegrityController + wire-up
  - [ ] F2 Task 14: Probe replay integration test
  - [ ] F2 Task 15: README + roadmap

- [ ] PR-11: Account reconciler foundations
  - [ ] F3 Task 1: Add F3 config vars
  - [ ] F3 Task 2: Add Postgres migration for account state tables
  - [ ] F3 Task 3: Add account types module
  - [ ] F3 Task 4: PositionStore
  - [ ] F3 Task 5: BalanceStore
  - [ ] F3 Task 6: OrderStore
  - [ ] F3 Task 7: FillsLedger

- [ ] PR-12: Reconciliation safety logic
  - [ ] F3 Task 8: DivergenceDetector
  - [ ] F3 Task 9: HeartbeatWatcher
  - [ ] F3 Task 10: DriftSweeper
  - [ ] F3 Task 11: Add gateway methods getOpenOrders + getFuturesTradeHistory
  - [ ] F3 Task 13: WS payload normalizers (zod)

- [ ] PR-13: Reconcile orchestration
  - [ ] F3 Task 12: Persistence module
  - [ ] F3 Task 14: ReconcileController scaffold + WS ingest
  - [ ] F3 Task 15: Boot seed + WS reconnect forced sweep
  - [ ] F3 Task 16: Wire controller into runApp
  - [ ] F3 Task 17: TUI consumes snapshot getter
  - [ ] F3 Task 18: Probe script for raw account-channel capture

- [ ] PR-14: Account-state hardening
  - [ ] F3 Task 19: Integration test (real Postgres, mocked WS+REST)
  - [ ] F3 Task 20: Quality gate + README phase update

## LATER (Strategy + Backtesting + Execution Rollout)

- [ ] PR-15: Strategy framework skeleton
  - [ ] F4 Task 1: Promote MarketState named export from state-builder
  - [ ] F4 Task 2: F4 config vars
  - [ ] F4 Task 3: Strategy types module
  - [ ] F4 Task 4: PassthroughRiskFilter
  - [ ] F4 Task 5: StrategyRegistry
  - [ ] F4 Task 6: ContextBuilder (live)

- [ ] PR-16: Strategy drivers
  - [ ] F4 Task 7: IntervalDriver
  - [ ] F4 Task 8: TickDriver
  - [ ] F4 Task 9: BarDriver
  - [ ] F4 Task 13: StrategyController
  - [ ] F4 Task 14: Wire StrategyController into runApp

- [ ] PR-17: Built-in strategies
  - [ ] F4 Task 10: SmcRule strategy
  - [ ] F4 Task 11: MaCross strategy
  - [ ] F4 Task 12: LlmPulse strategy (wraps existing AiAnalyzer)

- [ ] PR-18: Backtest data sources
  - [ ] F4 Task 15: Backtest types + DataSource interface
  - [ ] F4 Task 16: CandleSource
  - [ ] F4 Task 17: PostgresFillSource
  - [ ] F4 Task 18: JsonlSource

- [ ] PR-19: Backtest execution engine
  - [ ] F4 Task 19: Simulator
  - [ ] F4 Task 20: Metrics + TradeLedger CSV
  - [ ] F4 Task 21: Backtest Runner
  - [ ] F4 Task 22: Backtest CLI

- [ ] PR-20: Backtest verification
  - [ ] F4 Task 23: Integration test (Postgres + mocked WS/Ollama; gated by SKIP_DOCKER_TESTS)
  - [ ] F4 Task 24: Quality gate + README phase update

## Roadmap Execution Slices

- [ ] PR-21: Slice 1 runtime wiring (strategy signals -> intents behind disabled-by-default execution flag)
- [ ] PR-22: Slice 2 risk sizing (RiskSizer + risk budget)
- [ ] PR-23: Slice 3 paper execution (PaperExecutionEngine)
- [ ] PR-24: Slice 4 order lifecycle persistence
- [ ] PR-25: Slice 5 TUI execution panels
- [ ] PR-26: Slice 6 backtest execution model upgrade
- [ ] PR-27: Slice 7 live adapter behind strict safety gates
- [ ] PR-28: Slice 8 live canary controls
