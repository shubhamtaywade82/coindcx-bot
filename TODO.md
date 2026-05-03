# TODO

This checklist is organized into PR-sized slices. Each PR includes explicit scope and
verification details so progress can be tracked without opening multiple planning docs.

## NOW (Critical Path)

- [ ] PR-01: Foundation tooling baseline
  - [ ] Source tasks: F1 Task 1
  - [ ] Scope:
    - [ ] Establish strict TypeScript baseline (`tsconfig` + compiler settings).
    - [ ] Add lint/test tool configs (ESLint + Vitest) and align project scripts.
    - [ ] Add one sanity test to confirm the test harness is active.
  - [ ] Verification:
    - [ ] Run project quality checks and confirm toolchain is wired correctly.

- [ ] PR-02: Config + logging core
  - [ ] Source tasks: F1 Task 2, F1 Task 3
  - [ ] Scope:
    - [ ] Implement typed config schema with safe defaults and env validation.
    - [ ] Add secret redaction utility for logs/output.
    - [ ] Implement logger with structured output and redaction integration.
  - [ ] Verification:
    - [ ] Add/execute tests for schema parsing, redaction behavior, and logger behavior.

- [ ] PR-03: Database bootstrap
  - [ ] Source tasks: F1 Task 4, F1 Task 13 (infrastructure portion)
  - [ ] Scope:
    - [ ] Add initial Postgres migration and migration runner.
    - [ ] Implement DB pool management and startup migration execution.
    - [ ] Add local Postgres docker-compose service for development/test runs.
  - [ ] Verification:
    - [ ] Run migration flow end-to-end against local Postgres.

- [ ] PR-04: Signal plumbing
  - [ ] Source tasks: F1 Task 5, F1 Task 6
  - [ ] Scope:
    - [ ] Implement audit module with bounded queue behavior.
    - [ ] Implement SignalBus and default sinks (stdout + file).
    - [ ] Ensure sink interfaces are explicit and composable.
  - [ ] Verification:
    - [ ] Add/execute tests for queue bounds, publish flow, and sink output.

- [ ] PR-05: Safety controls
  - [ ] Source tasks: F1 Task 7, F1 Task 8, F1 Task 11
  - [ ] Scope:
    - [ ] Add Telegram sink with token bucket/retry handling.
    - [ ] Implement ReadOnlyGuard to block non-read API activity.
    - [ ] Wire ReadOnlyGuard through the CoinDCX API gateway path.
  - [ ] Verification:
    - [ ] Add tests proving blocked-write behavior and allowed-read behavior.

- [ ] PR-06: Runtime lifecycle
  - [ ] Source tasks: F1 Task 9, F1 Task 10, F1 Task 12, F1 Task 13 (docs portion)
  - [ ] Scope:
    - [ ] Add resume cursor persistence for safe restarts.
    - [ ] Implement lifecycle bootstrap/shutdown and runtime context wiring.
    - [ ] Move to new entrypoint shape and keep startup responsibilities explicit.
    - [ ] Update README for the finalized runtime/lifecycle behavior.
  - [ ] Verification:
    - [ ] Execute lifecycle smoke run (startup, steady state, graceful shutdown).

## NEXT (Core Product Capabilities)

- [ ] PR-07: Market data base contracts
  - [ ] Source tasks: F2 Task 1, F2 Task 2, F2 Task 3
  - [ ] Scope:
    - [ ] Add F2 config/dependencies and shared market data contracts.
    - [ ] Implement TailBuffer for raw frame capture.
    - [ ] Implement probe CLI for recording/inspection workflows.
  - [ ] Verification:
    - [ ] Run probe path against fixture or live stream and validate output format.

- [ ] PR-08: Book integrity engine
  - [ ] Source tasks: F2 Task 4, F2 Task 5, F2 Task 6, F2 Task 7
  - [ ] Scope:
    - [ ] Implement REST budget guard for resync calls.
    - [ ] Implement OrderBook state/apply/checksum behavior.
    - [ ] Implement BookManager orchestration and resync transitions.
  - [ ] Verification:
    - [ ] Add unit/property tests for book application and checksum consistency.

- [ ] PR-09: Market health monitoring
  - [ ] Source tasks: F2 Task 8, F2 Task 9, F2 Task 10, F2 Task 11, F2 Task 13
  - [ ] Scope:
    - [ ] Implement heartbeat watchdog and stale stream detection.
    - [ ] Implement latency tracker and exchange time-sync checks.
    - [ ] Feed real latency state to TUI badge.
  - [ ] Verification:
    - [ ] Add tests for health-state transitions and validate TUI displays real LAT.

- [ ] PR-10: Market controller integration
  - [ ] Source tasks: F2 Task 12, F2 Task 14, F2 Task 15
  - [ ] Scope:
    - [ ] Implement IntegrityController and wire it into runtime.
    - [ ] Add probe replay integration test with fixture frames.
    - [ ] Document finalized F2 behavior in README/roadmap.
  - [ ] Verification:
    - [ ] Run integration tests covering replay-driven controller behavior.

- [ ] PR-11: Account reconciler foundations
  - [ ] Source tasks: F3 Task 1, F3 Task 2, F3 Task 3, F3 Task 4, F3 Task 5, F3 Task 6, F3 Task 7
  - [ ] Scope:
    - [ ] Add F3 config and DB migration for account state storage.
    - [ ] Implement account domain types and core stores:
      - [ ] PositionStore
      - [ ] BalanceStore
      - [ ] OrderStore
      - [ ] FillsLedger
  - [ ] Verification:
    - [ ] Add tests proving store read/write behavior and schema compatibility.

- [ ] PR-12: Reconciliation safety logic
  - [ ] Source tasks: F3 Task 8, F3 Task 9, F3 Task 10, F3 Task 11, F3 Task 13
  - [ ] Scope:
    - [ ] Implement divergence detection and drift sweeps.
    - [ ] Implement heartbeat watcher for account channel health.
    - [ ] Extend gateway reads (`getOpenOrders`, `getFuturesTradeHistory`).
    - [ ] Add zod-based normalizers for WS payload shapes.
  - [ ] Verification:
    - [ ] Add tests for divergence signals, drift triggers, and normalizer failures.

- [ ] PR-13: Reconcile orchestration
  - [ ] Source tasks: F3 Task 12, F3 Task 14, F3 Task 15, F3 Task 16, F3 Task 17, F3 Task 18
  - [ ] Scope:
    - [ ] Implement persistence module and ReconcileController orchestration.
    - [ ] Add boot seed and reconnect-triggered forced sweep path.
    - [ ] Wire controller into `runApp` and update TUI to consume snapshots.
    - [ ] Add account probe script for raw account-channel capture.
  - [ ] Verification:
    - [ ] Run end-to-end reconcile flow with mocked WS + REST.

- [ ] PR-14: Account-state hardening
  - [ ] Source tasks: F3 Task 19, F3 Task 20
  - [ ] Scope:
    - [ ] Add integration test coverage (real Postgres + mocked WS/REST).
    - [ ] Run quality gate and update README phase status.
  - [ ] Verification:
    - [ ] Confirm integration tests and quality gate pass under documented conditions.

## LATER (Strategy + Backtesting + Execution Rollout)

- [ ] PR-15: Strategy framework skeleton
  - [ ] Source tasks: F4 Task 1, F4 Task 2, F4 Task 3, F4 Task 4, F4 Task 5, F4 Task 6
  - [ ] Scope:
    - [ ] Promote/export `MarketState` cleanly from state-builder.
    - [ ] Add F4 config and strategy domain types.
    - [ ] Implement PassthroughRiskFilter, StrategyRegistry, and ContextBuilder.
  - [ ] Verification:
    - [ ] Add tests for registration, context generation, and risk-filter passthrough.

- [ ] PR-16: Strategy drivers
  - [ ] Source tasks: F4 Task 7, F4 Task 8, F4 Task 9, F4 Task 13, F4 Task 14
  - [ ] Scope:
    - [ ] Implement interval/tick/bar drivers with deterministic dispatch behavior.
    - [ ] Implement StrategyController and wire to runtime lifecycle.
  - [ ] Verification:
    - [ ] Validate driver scheduling + dispatch order in controller tests.

- [ ] PR-17: Built-in strategies
  - [ ] Source tasks: F4 Task 10, F4 Task 11, F4 Task 12
  - [ ] Scope:
    - [ ] Implement SmcRule and MaCross strategies.
    - [ ] Implement LlmPulse strategy wrapping existing AiAnalyzer.
  - [ ] Verification:
    - [ ] Add strategy-level behavior tests using deterministic fixtures.

- [ ] PR-18: Backtest data sources
  - [ ] Source tasks: F4 Task 15, F4 Task 16, F4 Task 17, F4 Task 18
  - [ ] Scope:
    - [ ] Define backtest contracts (`DataSource` + type surface).
    - [ ] Implement CandleSource, PostgresFillSource, and JsonlSource adapters.
  - [ ] Verification:
    - [ ] Add adapter tests for cursoring, ordering, and schema validation.

- [ ] PR-19: Backtest execution engine
  - [ ] Source tasks: F4 Task 19, F4 Task 20, F4 Task 21, F4 Task 22
  - [ ] Scope:
    - [ ] Implement simulator execution path and event loop.
    - [ ] Implement metrics and TradeLedger CSV output.
    - [ ] Implement backtest runner and CLI entrypoint.
  - [ ] Verification:
    - [ ] Execute sample backtest and verify metrics + ledger output integrity.

- [ ] PR-20: Backtest verification
  - [ ] Source tasks: F4 Task 23, F4 Task 24
  - [ ] Scope:
    - [ ] Add integration test (Postgres + mocked WS/Ollama, Docker-gated).
    - [ ] Run final quality gate and update README phase status.
  - [ ] Verification:
    - [ ] Confirm gated integration path and non-Docker fallback behavior.

## Roadmap Execution Slices

- [ ] PR-21: Slice 1 runtime wiring (signals -> intents behind disabled-by-default execution flag)
  - [ ] Details:
    - [ ] Introduce intent boundary without submitting live orders.
    - [ ] Add feature flag defaulting to execution disabled.
  - [ ] Verification:
    - [ ] Confirm intents are emitted and execution remains hard-disabled by default.

- [ ] PR-22: Slice 2 risk sizing (RiskSizer + risk budget)
  - [ ] Details:
    - [ ] Implement deterministic sizing rules and risk budget checks.
    - [ ] Reject intents that exceed budget constraints.
  - [ ] Verification:
    - [ ] Add tests for budget acceptance/rejection thresholds.

- [ ] PR-23: Slice 3 paper execution (PaperExecutionEngine)
  - [ ] Details:
    - [ ] Implement simulated order lifecycle transitions.
    - [ ] Persist paper fills and status changes for auditability.
  - [ ] Verification:
    - [ ] Run scenario tests for submit/fill/cancel/reject transitions.

- [ ] PR-24: Slice 4 order lifecycle persistence
  - [ ] Details:
    - [ ] Persist intent/order/fill lifecycle events to DB.
    - [ ] Add query interfaces for status timelines.
  - [ ] Verification:
    - [ ] Validate timeline reconstruction from persisted events.

- [ ] PR-25: Slice 5 TUI execution panels
  - [ ] Details:
    - [ ] Add TUI panels for intents, risk decisions, and execution state.
    - [ ] Keep display state derived from canonical runtime snapshots.
  - [ ] Verification:
    - [ ] Confirm panel values match emitted events in smoke run.

- [ ] PR-26: Slice 6 backtest execution model upgrade
  - [ ] Details:
    - [ ] Align backtest engine with intent/risk/execution boundary model.
    - [ ] Ensure backtest and runtime share strategy/execution contracts.
  - [ ] Verification:
    - [ ] Re-run baseline scenarios and compare expected metric deltas.

- [ ] PR-27: Slice 7 live adapter behind strict safety gates
  - [ ] Details:
    - [ ] Add live adapter disabled by default and guarded by multiple gates.
    - [ ] Require explicit runtime approvals before any live order path.
  - [ ] Verification:
    - [ ] Prove all safety gates must pass before adapter can send live requests.

- [ ] PR-28: Slice 8 live canary controls
  - [ ] Details:
    - [ ] Add canary constraints (pair allowlist, size cap, kill switch).
    - [ ] Add monitoring hooks and fast rollback controls.
  - [ ] Verification:
    - [ ] Run canary simulation and validate emergency stop behavior.
