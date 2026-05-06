# Prerequisites Implementation Plan

Tracking doc for the trading-prerequisite scaffolds added on
`claude/audit-bot-prerequisites-s2aBW`. Each item is a separate iteration —
landed as a self-contained PR with tests before the box is checked.

This doc is the **single source of truth** for status. When a slice flips from
`scaffold` → `implemented`, update the table below in the same commit and tick
the per-iteration checklist further down.

The bot is **read-only**. None of these items may add, unblock, or hint at
order placement. Position sizing, execution simulation, and Kelly math are
permitted because they live in signal payloads and the offline backtester only —
the `ReadOnlyGuard` on every axios client (`src/safety/read-only-guard.ts`)
must remain in force.

---

## Status legend

| Marker | Meaning |
| --- | --- |
| `scaffold` | File exists with detailed comments + typed signatures; no real logic |
| `partial` | Some logic landed, gated/disabled; not yet wired into runtime |
| `wired` | Implementation complete + registered in `src/index.ts` / pipeline |
| `validated` | `wired` + unit tests + walk-forward / Monte-Carlo evidence under `docs/` |

Last column is the registration target — where the slice has to plug in once
implementation lands (do **not** wire scaffolds; they will throw or no-op).

---

## Scaffolds

| # | Slice | File(s) | Status | Wire-in target |
| --- | --- | --- | --- | --- |
| 1 | Kill-zone session gate | `src/strategy/risk/rules/kill-zone.ts` | scaffold | `CompositeRiskFilter` build in `src/index.ts` |
| 2 | Volume Profile / VWAP value areas | `src/marketdata/indicators/volume-profile.ts` | scaffold | `intraday-indicators.ts` consumer + `ConfluenceScorer` |
| 3 | Wyckoff phase detector strategy | `src/strategy/strategies/wyckoff-phase.ts` | scaffold | Strategy registration in `src/index.ts` (gated by `STRATEGY_ENABLED_IDS`) |
| 4 | Order-flow footprint / aggressor imbalance | `src/marketdata/indicators/order-flow-footprint.ts` | scaffold | Extends `intraday-indicators.ts.rollingOrderFlowImbalance`; consumed by `ConfluenceScorer` |
| 5 | Mean-reversion strategy | `src/strategy/strategies/mean-reversion.ts` | scaffold | Strategy registration in `src/index.ts` |
| 6 | RSI / MACD divergence strategy | `src/strategy/strategies/divergence.ts` | scaffold | Strategy registration in `src/index.ts` |
| 7 | Canonical TA validation harness | `src/indicators/canonical/validation-harness.ts` | scaffold | Vitest suite under `tests/indicators/canonical/` (no runtime registration) |
| 8 | Position sizing (Kelly + vol-target) | `src/runtime/sizing/position-sizing.ts` | scaffold | `TradePlanEngine.compute` in `src/runtime/trade-plan.ts` |
| 9 | Monte Carlo / sensitivity overfitting defenses | `src/strategy/backtest/monte-carlo.ts`, `src/strategy/backtest/sensitivity.ts` | scaffold | `runWalkForwardValidation` orchestrator + new CLI flags |
| 10 | Execution-sim realism | `src/strategy/backtest/execution/partial-fills.ts`, `queue-model.ts`, `slicing.ts` | scaffold | `Simulator.markToMarket*` in `src/strategy/backtest/simulator.ts` |

---

## Iteration order (suggested)

Lower-risk, highest-leverage first — each step is independently shippable:

1. **#1 Kill-zone** — pure RiskRule, smallest blast radius, sharpens existing SMC signal quality.
2. **#9 Monte Carlo / sensitivity** — improves trust in everything that already exists; no runtime change.
3. **#4 Order-flow footprint** — confluence input only; no new strategy.
4. **#2 Volume profile / VWAP** — confluence + new indicator surface.
5. **#7 TA validation harness** — bolts a test-only safety net under our bespoke indicators.
6. **#8 Position sizing** — once #9 + #1 are in we have evidence to upgrade sizing safely.
7. **#3 Wyckoff** — first new strategy; depends on #2 (volume context).
8. **#5 Mean-reversion** — orthogonal regime coverage.
9. **#6 Divergence** — final new strategy.
10. **#10 Execution-sim realism** — only meaningful once we have multiple strategies to stress-test.

Re-order freely — each scaffold is standalone.

---

## Per-iteration checklist

Each scaffold's file header repeats this list. Tick boxes here when a slice
graduates so the doc stays canonical.

### 1. Kill-zone RiskRule
- [ ] Implement London / NY / Asia window logic with config-driven UTC offsets
- [ ] Add `RISK_KILLZONE_*` env keys to `src/config/schema.ts`
- [ ] Wire into `CompositeRiskFilter` (after `MinConfidence`, before `Cooldown`)
- [ ] Unit tests: window edges, weekend handling, DST transitions
- [ ] Update status to `wired` then `validated`

### 2. Volume Profile / VWAP value areas
- [ ] Implement TPO/volume binning + VAH/VAL/POC extraction
- [ ] Plug daily / weekly anchored VWAP bands into `IntradayIndicators`
- [ ] `ConfluenceScorer` reads value-area touch as a long/short component
- [ ] Tests: known-fixture profile, value-area invariants

### 3. Wyckoff phase strategy
- [ ] Phase detector: A (stop), B (build), C (test), D (markup), E (distribution)
- [ ] Spring / upthrust detection with volume-profile confirmation (depends on #2)
- [ ] Strategy manifest + bar-close trigger; gated by `STRATEGY_ENABLED_IDS`
- [ ] Backtest fixture covering at least one full accumulation→markup cycle

### 4. Order-flow footprint
- [ ] Aggressor imbalance per price bin from `TradeFlow` ticks
- [ ] Stacked-imbalance / absorption detection
- [ ] Surface as new field on `IntradayIndicators` (extend type)
- [ ] Confluence consumer

### 5. Mean-reversion strategy
- [ ] Bollinger Z-score + ATR-percentile regime gate (only fire in low-vol mean-revert regimes)
- [ ] Stop = 2× ATR opposite mean; TP = midband
- [ ] Strategy manifest + tests

### 6. RSI / MACD divergence strategy
- [ ] Pivot-based divergence (regular + hidden) on `RsiDivergenceSignal` outputs
- [ ] MACD histogram divergence cross-check
- [ ] Strategy manifest + tests

### 7. Canonical TA validation harness
- [ ] Implement reference EMA, RSI, ATR, MACD, Bollinger using textbook formulas
- [ ] Property-based tests (`fast-check` already in deps) comparing bespoke vs canonical
- [ ] CI script (`npm run test`) covers a regression fixture

### 8. Position sizing
- [ ] Kelly fraction estimator from rolling backtest stats (winRate, avgWin/avgLoss)
- [ ] Vol-target sizer using ATR-percentile
- [ ] `TradePlanEngine.compute` accepts a `sizingMode` and switches deterministically
- [ ] Capped by existing 10× hard leverage; no path can exceed it

### 9. Monte Carlo + sensitivity
- [ ] Trade-sequence permutation: shuffle ledger, recompute Sharpe / DD distribution
- [ ] Parameter sweep with grid + report stability surface
- [ ] CLI flags on `npm run backtest` (`--monte-carlo N`, `--sensitivity grid.json`)
- [ ] Output JSON + markdown report under `docs/backtest-reports/`

### 10. Execution-sim realism
- [ ] Partial-fill model parameterised by orderbook depth at price
- [ ] Queue-position model for limit orders
- [ ] TWAP / VWAP slicing for parent intents (still simulated only)
- [ ] Wire into `Simulator.markToMarket*`; `pessimistic` flag becomes one preset of many

---

## Hard constraints (re-stated for the implementer)

- `socket.io-client` pinned at `2.4.0` — do not bump.
- All futures endpoints via `futures-endpoint-resolver`, never hardcoded.
- Hard leverage cap remains 10× (`TRADEPLAN_HARD_MAX_LEVERAGE`).
- Liquidation distance ≥ 2× stop distance.
- No path bypasses `ReadOnlyGuard`. New CLI flags must not introduce write paths.
- Every new env var lands in `src/config/schema.ts` and `.env.example`.
- New migrations live under `src/db/migrations/` with the numeric timestamp prefix.
