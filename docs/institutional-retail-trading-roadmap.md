# Institutional Retail Trading Roadmap

This document defines the roadmap for evolving `coindcx-bot` from a read-only observation and signal platform into a controlled, retail-safe automated crypto futures trading system.

The current system should remain read-only by default. Live trading must be introduced as a separate execution subsystem behind explicit safety gates, paper-mode validation, and hard risk limits.

## Current State

The codebase already provides a strong foundation:

- Market data integrity: order book state, resync, stale-feed checks, heartbeat monitoring, latency tracking, time-sync alarms, and probe tooling.
- Account state: positions, balances, orders, fills ledger, drift sweeps, divergence detection, persistence, and audit events.
- Strategy framework: pluggable strategies with interval, tick, and bar-close cadences.
- Signal bus: structured signal persistence and fan-out to sinks.
- Risk alerts: composable rules for confidence, concurrency, cooldown, drawdown, per-strategy exposure, and opposing-pair correlation.
- Backtesting: shared strategy contract with basic metrics and trade ledger.
- TUI: market, account, strategy, signal, and risk panels.
- Safety: `ReadOnlyGuard` blocks order and position mutation endpoints.

The codebase is not yet an automated execution system. It does not place live orders, size positions, manage order lifecycle, or enforce full pre-trade/post-trade controls.

## Target Architecture

Strategies should never place orders directly. They produce signals, which are converted into validated trade intents. Only approved intents can reach execution.

```text
Market Data + Account State
        |
        v
Strategy Signals
        |
        v
Signal Validation
        |
        v
TradeIntent
        |
        v
RiskSizer + RiskGate
        |
        v
PaperExecutionEngine
        |
        v
LiveExecutionEngine
        |
        v
OrderManager + ExecutionReconciler
        |
        v
Audit + Metrics + TUI + Alerts
```

## Operating Modes

- `READ_ONLY=true`: default mode. Observes market/account state and emits signals only.
- `PAPER_TRADING=true`: runs the full execution lifecycle against a simulated exchange adapter.
- `LIVE_TRADING=true`: enables live order submission only after paper-mode acceptance criteria pass.

Live mode must require explicit configuration flags and startup checks. It must never be enabled implicitly.

## Regression-Safe Delivery Plan

All future work on this roadmap should happen outside the current working branch. The current read-only system is the regression baseline and must remain deployable throughout the execution buildout.

Recommended branch:

```bash
git switch feat/f6-tui-v2
git pull --ff-only
git switch -c institutional-retail-trading
```

If the team prefers the existing naming convention:

```bash
git switch -c feat/institutional-retail-trading
```

The branch should be developed as a sequence of small, reviewable slices:

- Slice 1: `TradeIntent` model and validation only.
- Slice 2: `RiskSizer` and risk budget only.
- Slice 3: paper execution engine only.
- Slice 4: execution persistence only.
- Slice 5: TUI execution panels only.
- Slice 6: backtest execution upgrade only.
- Slice 7: live adapter behind disabled flags only.
- Slice 8: live canary controls only.

Regression rules:

- Keep `READ_ONLY=true` as the default in every commit.
- Existing signal generation must continue to work without execution modules enabled.
- Existing TUI panels must continue to render if execution modules are disabled.
- Existing backtest CLI must continue to run before the upgraded simulator replaces it.
- Execution code must be behind config flags until paper mode is complete.
- Live CoinDCX write endpoints must not be callable until the live adapter phase.
- Any new write endpoint wrapper must be blocked by startup safety checks unless `LIVE_TRADING=true`.
- Every slice must pass `npm run typecheck`.
- Every slice must pass the relevant focused tests.
- Before merging the branch, run `npm run check`.

Compatibility strategy:

- Add new modules under `src/execution/` instead of changing strategies to place orders.
- Keep `StrategySignal` backward-compatible while introducing `TradeIntent`.
- Convert signals to intents in a dedicated adapter.
- Keep risk alerts separate from pre-trade risk sizing until the sizing layer is stable.
- Keep paper execution and live execution behind the same `ExecutionEngine` interface.
- Add database migrations append-only; do not rewrite existing migrations.
- Do not remove the `ReadOnlyGuard`; live trading should use a separate guarded trading API wrapper.

Rollback strategy:

- If a new execution slice misbehaves, disable it with config and keep read-only signals running.
- If paper execution corrupts its own state, truncate only the new execution tables.
- If live canary misbehaves, trigger kill switch, stop new orders, reconcile account state, and return to `READ_ONLY=true`.
- Never require execution modules for monitoring, account reconciliation, market integrity, or TUI startup.

## Implementation Progress

- `[done]` Slice 1 foundation: added `TradeIntent`, signal-to-intent mapping, and deterministic intent validation under `src/execution/`.
- `[pending]` Slice 1 runtime wiring: convert strategy signals to intents behind a disabled-by-default execution flag.
- `[pending]` Slice 2: add `RiskSizer` and risk budget.
- `[pending]` Slice 3: add `PaperExecutionEngine`.
- `[pending]` Slice 4: add order lifecycle persistence.
- `[pending]` Slice 5: add TUI execution panels.
- `[pending]` Slice 6: upgrade backtest execution model.
- `[pending]` Slice 7: add live adapter behind strict safety gates.
- `[pending]` Slice 8: add live canary controls.

## When Can This Go Live?

The bot should not trade live in its current state. Today it is a read-only signal and monitoring system. That is intentional and should remain the default until the execution and risk-management layers exist.

Live trading should be treated as a staged release, not a switch flipped after adding an order endpoint.

### Earliest Responsible Live Path

The earliest responsible path to real trading is:

1. Build `TradeIntent`, deterministic validation, and risk sizing.
2. Build paper execution using the same order lifecycle planned for live.
3. Persist intents, risk decisions, orders, fills, and order events.
4. Upgrade backtesting so it includes fees, spread, slippage, funding, margin, and liquidation assumptions.
5. Run paper trading for at least 2-4 weeks.
6. Compare paper results against backtest assumptions.
7. Add the live CoinDCX execution adapter behind strict safety flags.
8. Run live canary mode with tiny max notional, one pair, and one strategy.

### Practical Timeline Estimate

These are engineering estimates, not guarantees:

- `2-4 weeks`: build `TradeIntent`, `IntentValidator`, `RiskSizer`, and risk budget.
- `3-6 weeks`: build paper execution, order lifecycle persistence, and TUI execution panels.
- `2-4 weeks`: upgrade backtesting and run walk-forward reports.
- `2-4 weeks`: paper trading soak period with daily review.
- `1-2 weeks`: add live adapter and live safety checks.
- `1-2 weeks`: live canary with tiny notional.

Realistic first live canary: `10-18 weeks` if implementation is steady and paper results are acceptable.

Fast but still responsible path: `6-8 weeks` only if scope is limited to one pair, one strategy, paper execution is simple, and the first live phase uses tiny fixed notional.

Unsafe path: adding live order placement directly to current strategy signals. This should not be done.

### Live Readiness Checklist

Live trading is allowed only when all of these are true:

- `READ_ONLY=false`.
- `LIVE_TRADING=true`.
- `PAPER_TRADING=false`.
- `I_UNDERSTAND_LIVE_RISK=true`.
- `TradeIntent` validation exists and cannot be bypassed.
- `RiskSizer` exists and sets max loss before order submission.
- Global kill switch exists and has been tested.
- Per-symbol kill switch exists and has been tested.
- Order lifecycle persistence exists.
- Restart does not duplicate orders.
- Exchange reconciliation can detect orphaned or missing orders.
- Every filled entry is protected by stop logic.
- Stale market data blocks new orders.
- Account divergence blocks new orders.
- Clock skew above threshold blocks new orders.
- Daily loss limit blocks new orders.
- Max notional cap blocks oversizing.
- Max leverage cap blocks excessive leverage.
- Backtest report includes fees, slippage, spread, funding, and liquidation assumptions.
- Paper trading has run for at least 2-4 weeks.
- Paper results are close enough to backtest assumptions.
- No unresolved critical execution bugs exist.
- Operator can stop the system with one command.

### Live Canary Rules

The first live release should be a canary:

- One pair only.
- One strategy only.
- Tiny fixed max notional.
- Risk below normal production risk budget.
- No compounding.
- No averaging down.
- No automatic size increase.
- Daily manual review required.
- Stop live trading immediately after any unprotected fill, duplicate order, reconciliation failure, or unexplained account divergence.

### Promotion Beyond Canary

Increase size only after:

- Live slippage matches paper assumptions.
- Order rejection rate is acceptable.
- No duplicate order submissions occur.
- No unprotected entries occur.
- Realized drawdown stays inside budget.
- Strategy expectancy remains positive after fees and slippage.
- At least 20-30 live trades or a full market-regime sample has been reviewed.

## Phase 1: Trade Intent Boundary

Goal: create a professional boundary between "strategy sees opportunity" and "system may risk capital."

Add a `TradeIntent` model:

```ts
interface TradeIntent {
  id: string;
  strategyId: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  entryType: 'market' | 'limit';
  entryPrice?: string;
  stopLoss: string;
  takeProfit: string;
  confidence: number;
  ttlMs: number;
  createdAt: string;
  reason: string;
  metadata?: Record<string, unknown>;
}
```

Add deterministic validation:

- LONG requires `stopLoss < entry < takeProfit`.
- SHORT requires `takeProfit < entry < stopLoss`.
- Reject missing stop loss or take profit.
- Reject stale signals.
- Reject invalid or non-finite prices.
- Reject RR below minimum.
- Reject stop distance below/above configured bounds.
- Reject if spread is too wide.
- Reject if market/account data is stale or divergent.

Likely files:

- `src/execution/trade-intent.ts`
- `src/execution/intent-validator.ts`
- `tests/execution/intent-validator.test.ts`

Acceptance criteria:

- Every executable signal becomes either a valid `TradeIntent` or a structured rejection reason.
- No strategy can bypass intent validation.
- Rejections are persisted and visible in TUI/signals.

## Phase 2: Risk Sizing And Risk Budget

Goal: convert approved trade intents into exact size and max loss.

Add `RiskSizer`:

```ts
interface RiskDecision {
  approved: boolean;
  reason?: string;
  qty?: string;
  notional?: string;
  leverage?: number;
  maxLoss?: string;
  riskPct?: number;
}
```

Inputs:

- Account equity.
- Available margin.
- Pair metadata.
- Entry price.
- Stop loss.
- Max risk per trade.
- Max daily loss.
- Max total open risk.
- Leverage cap.
- Fee buffer.
- Slippage buffer.
- Liquidation buffer.
- Minimum/maximum order size.

Rules:

- Risk per trade defaults to `0.25% - 0.50%` of equity.
- Max daily loss defaults to `1.5% - 2.0%`.
- Max weekly loss defaults to `4% - 5%`.
- Max total open risk defaults to `3%`.
- Max concurrent positions defaults to `1 - 3`.
- Max leverage defaults to `2x - 3x`.
- No averaging down.
- No trade if liquidation buffer is too small.
- No trade during stale feed or account divergence.

Likely files:

- `src/risk/risk-sizer.ts`
- `src/risk/risk-budget.ts`
- `src/risk/rules/liquidation-buffer.ts`
- `tests/risk/risk-sizer.test.ts`

Acceptance criteria:

- Every trade has deterministic size.
- Every rejection includes a human-readable reason.
- Risk budget survives restart through persisted state.

## Phase 3: Paper Execution Engine

Goal: run the full execution lifecycle without live orders.

Add an execution interface:

```ts
interface ExecutionEngine {
  submit(intent: ApprovedTradeIntent): Promise<OrderPlan>;
  cancel(orderId: string): Promise<void>;
  sync(): Promise<void>;
}
```

Paper engine should simulate:

- Market fills.
- Limit fills.
- Partial fills.
- Spread.
- Slippage.
- Latency.
- Fees.
- Funding approximation.
- Stop loss and take profit execution.
- Rejected orders.

Likely files:

- `src/execution/execution-engine.ts`
- `src/execution/paper-engine.ts`
- `src/execution/order-types.ts`
- `src/execution/order-store.ts`
- `tests/execution/paper-engine.test.ts`

Acceptance criteria:

- Paper mode uses the same `TradeIntent`, `RiskSizer`, and `OrderManager` flow planned for live mode.
- Paper fills are persisted.
- TUI shows paper orders, fills, PnL, and rejected intents.

## Phase 4: Order Lifecycle Manager

Goal: make execution stateful, idempotent, and recoverable.

Add `OrderManager` states:

- `created`
- `validated`
- `risk_approved`
- `submitted`
- `partially_filled`
- `filled`
- `protected`
- `cancelled`
- `rejected`
- `expired`
- `orphaned`
- `closed`

Responsibilities:

- Convert approved intent into entry and protective orders.
- Ensure every filled entry has stop protection.
- Prevent duplicate submissions with idempotency keys.
- Track partial fills.
- Track position linkage.
- Recover on reconnect/restart.
- Reconcile exchange state against internal state.
- Emit structured order lifecycle events.

New tables:

- `trade_intents`
- `risk_decisions`
- `execution_orders`
- `execution_fills`
- `order_events`

Likely files:

- `src/execution/order-manager.ts`
- `src/execution/order-reconciler.ts`
- `src/db/migrations/*_execution_tables.js`

Acceptance criteria:

- Restart does not duplicate orders.
- Filled entries without protective stops are detected as critical incidents.
- Order state can be reconstructed from persisted events.

## Phase 5: Backtest Upgrade

Goal: make backtest results comparable to paper and live trading.

Add execution-aware simulation:

- Fees.
- Funding.
- Spread.
- Slippage.
- Latency.
- Limit order fill assumptions.
- Partial fills.
- Rejections.
- Leverage.
- Margin.
- Liquidation checks.
- Position sizing from `RiskSizer`.

Add metrics:

- Expectancy.
- R multiple distribution.
- Profit factor.
- Max drawdown.
- Drawdown duration.
- Max daily loss.
- MAE and MFE.
- Average slippage.
- Fee-adjusted PnL.
- Win rate by market regime.
- Performance by strategy and pair.

Likely files:

- `src/strategy/backtest/execution-simulator.ts`
- `src/strategy/backtest/fee-model.ts`
- `src/strategy/backtest/slippage-model.ts`
- `src/strategy/backtest/walk-forward.ts`

Acceptance criteria:

- Backtests consume the same `TradeIntent` and `RiskSizer` flow as paper/live.
- Report includes fee/slippage-adjusted results.
- Walk-forward report exists before live mode.

## Phase 6: Strategy Governance

Goal: make signals measurable, auditable, and controlled.

Add strategy metadata:

- Allowed pairs.
- Allowed sessions.
- Market regime compatibility.
- Minimum RR.
- Max holding time.
- Max trades per day.
- Required validators.
- Confidence calibration.

Improve AI usage:

- LLM should not be final authority.
- Deterministic rules should produce or validate setup candidates.
- LLM may summarize, classify, rank, or explain.
- Final approval must come from validators and risk sizing.

Add scoring:

- Structure score.
- Liquidity score.
- Volatility score.
- Spread/liquidity score.
- Trend alignment score.
- AI advisory score.

Acceptance criteria:

- Each emitted trade intent has deterministic validation evidence.
- LLM-only trades are impossible.
- Strategy performance is tracked by pair, regime, and setup type.

## Phase 7: Live Execution Adapter

Goal: add live execution only after paper mode is stable.

Add CoinDCX live adapter:

- Create order.
- Cancel order.
- Query order status.
- Exit position.
- Set leverage if supported and required.
- Place protective SL/TP if supported.

Safety requirements:

- `READ_ONLY=false`.
- `LIVE_TRADING=true`.
- `PAPER_TRADING=false`.
- Explicit acknowledgement flag such as `I_UNDERSTAND_LIVE_RISK=true`.
- Max notional cap.
- Max leverage cap.
- Global kill switch enabled.
- DB migrations up to date.
- Account state fresh.
- Market data fresh.
- Clock skew below threshold.
- No unresolved account divergence.

Likely files:

- `src/execution/coindcx-live-engine.ts`
- `src/gateways/coindcx-trading-api.ts`
- `src/safety/live-trading-guard.ts`

Acceptance criteria:

- Live adapter passes sandbox/paper parity tests.
- Startup fails closed when safety checks fail.
- Live order submit path has idempotency and persistence before exchange call.

## Phase 8: Production Operations

Goal: run like a small trading desk.

Add:

- `/health`.
- `/ready`.
- Prometheus metrics.
- Alert severity routing.
- Daily PnL report.
- Strategy performance report.
- Execution quality report.
- Kill switch CLI.
- Manual flatten command with explicit confirmation.
- Runbook documentation.

Metrics:

- Feed latency.
- Candle freshness.
- Account divergence.
- Signal count.
- Intent approval/rejection count.
- Order rejection rate.
- Fill latency.
- Slippage.
- Realized and unrealized PnL.
- Open risk.
- Drawdown.
- Model timeout rate.
- Strategy error rate.

Acceptance criteria:

- Operator can tell whether the system is safe to trade within 10 seconds.
- Alerts include reason, severity, affected pair, and recommended action.
- Kill switch works in paper and live modes.

## Retail Institutional Defaults

Recommended hard defaults:

- Risk per trade: `0.25% - 0.50%`.
- Max daily loss: `1.5% - 2.0%`.
- Max weekly loss: `4% - 5%`.
- Max concurrent positions: `1 - 3`.
- Max leverage: `2x - 3x`.
- Minimum RR: `1.5R`, preferably `2R+`.
- No trading during stale feed/account divergence.
- No averaging down.
- No signal without stop loss.
- No live order without paper-mode parity.
- No LLM-only trades.
- No auto-trading during startup warmup.
- No trade if spread/slippage exceeds expected edge.
- No trade if liquidation distance is too close to stop loss.

## Paper-To-Live Promotion Gates

Before live trading:

- At least 2-4 weeks paper trading.
- Paper results match backtest assumptions within acceptable tolerance.
- No unresolved execution lifecycle bugs.
- No duplicate order submissions.
- No unprotected filled entries.
- No missed stop simulations.
- Strategy has positive expectancy after fees and slippage.
- Max drawdown stays within configured risk budget.
- Operator can stop trading with one command.

Live rollout:

- Start with tiny fixed max notional.
- Keep max risk below normal risk budget during canary.
- Run one pair only.
- Run one strategy only.
- Require daily review.
- Increase size only after live slippage, rejections, and drawdown match paper expectations.

## Recommended Implementation Order

1. Build `TradeIntent` and `IntentValidator`.
2. Build `RiskSizer` and `RiskBudget`.
3. Build `PaperExecutionEngine`.
4. Add order lifecycle persistence.
5. Add execution panels to TUI.
6. Upgrade backtester to use the execution model.
7. Add strategy governance and deterministic signal scoring.
8. Run paper trading soak test.
9. Add live adapter behind strict safety gates.
10. Run live canary with tiny max notional.

The next concrete milestone should be Phase 1 and Phase 2 together: `TradeIntent -> IntentValidator -> RiskSizer`. This gives the system a professional boundary between opportunity detection and capital risk.
