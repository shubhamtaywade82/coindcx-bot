# F4 — Strategy/Signal Framework + Backtester

**Date:** 2026-04-27
**Status:** Draft for review
**Phase:** 4 of 6
**Depends on:** F1 (config, logger, audit, SignalBus, ReadOnlyGuard, Postgres pool), F2 (WsManager, MarketState, candle/tick streams, time-sync), F3 (AccountSnapshot, fills ledger)

## Hard Constraint

Read-only forever. F4 emits strategy signals onto F1 SignalBus; never places, cancels, or modifies orders. ReadOnlyGuard remains the enforcement layer; no new write-side endpoints introduced.

## Goals

A pluggable strategy framework that:
- Replaces the monolithic `AiAnalyzer` with a registry of multiple strategies (rule-based + LLM).
- Drives strategies on per-strategy declared cadences (interval / tick / bar-close).
- Emits richer signals (side + confidence + entry/SL/TP) on the existing SignalBus.
- Defines the `RiskFilter` boundary for F5 to swap in.
- Ships a deterministic backtester that replays historical data through the same Strategy contract and produces standard performance metrics + per-trade CSV.

## Decisions (made during brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Q0 | Decomposition | Combined F4a + F4b in one spec |
| Q1 | Strategy types | Deterministic + keep existing LLM as one strategy |
| Q2 | Cadence | Mixed — per-strategy declared `interval` / `tick` / `bar_close` |
| Q3 | Backtest data | Hybrid — REST candles + Postgres fills + JSONL probe captures |
| Q4 | Strategy state | In-memory; warmup re-fills on restart via `getCandles` |
| Q5 | Backtest metrics | Standard (Sharpe, max drawdown, profit factor, win rate) + per-trade CSV |
| Q6 | Signal richness | Side + confidence + entry/SL/TP |
| Q7 | Risk integration | F4 defines `RiskFilter` interface + passthrough impl; F5 swaps real impl |
| Q8 | Architecture | Per-component split mirroring F2/F3 (registry, drivers, context builder, risk, strategies, backtest, controller) |

## Architecture

```
src/
  strategy/
    types.ts                  Strategy interface, StrategyContext, StrategySignal, RiskFilter, Manifest, Mode
    registry.ts               Map<id, Strategy>; enable/disable; per-pair instance isolation; perf counters
    scheduler/
      interval-driver.ts      timer wakes interval-mode strategies
      tick-driver.ts          WS subscriptions → tick-mode strategies; per (strategy, pair) backpressure
      bar-driver.ts           candle-close detection → bar-mode strategies
    context-builder.ts        composes StrategyContext from MarketStateBuilder + account.snapshot()
    risk/
      risk-filter.ts          RiskFilter interface + PassthroughRiskFilter impl
    strategies/
      smc-rule.ts             deterministic SMC rules (BOS + OB confluence)
      ma-cross.ts             deterministic MA crossover example
      llm-pulse.ts            wraps existing AiAnalyzer behind Strategy interface
    controller.ts             top-level wiring; replaces direct AiAnalyzer usage in runApp
    backtest/
      runner.ts               orchestrator
      data-source.ts          unified iterator: REST candles, Postgres fills, JSONL probe
      simulator.ts            applies StrategySignal → simulated fills → tradeLedger
      metrics.ts              Sharpe, max drawdown, profit factor, win rate
      trade-ledger.ts         per-trade rows + CSV export
  cli/
    backtest.ts               npm run backtest entrypoint
```

Wiring change in `index.ts`:

```ts
const strategy = new StrategyController({
  signalBus: ctx.bus,
  account,                                   // F3 controller
  marketStateBuilder: ctx.stateBuilder,      // F1 context already exposes
  ws,
  restApi: CoinDCXApi,
  config: ctx.config,
  riskFilter: new PassthroughRiskFilter(),
});
strategy.register(new SmcRule());
strategy.register(new MaCross());
strategy.register(new LlmPulse(ctx.analyzer));   // wraps existing AiAnalyzer
await strategy.boot();
strategy.start();
```

The existing `MarketStateBuilder` and `AiAnalyzer` are preserved — `AiAnalyzer` is consumed by `LlmPulse` strategy, no longer driven directly from `runApp`.

Boundaries:
- **Strategy** = pure compute. Receives `StrategyContext` (read-only), returns `StrategySignal | null`. Holds private state across calls.
- **Drivers** = own scheduling + ctx assembly. One per cadence mode.
- **Registry** = lifecycle owner; instantiates one strategy instance per pair when `manifest.pairs.length > 1` to prevent cross-pair state pollution.
- **RiskFilter** = post-strategy gate; passthrough now, F5 swaps in.
- **Backtest** = same Strategy contract; differs only in driver + data source.

## Strategy Contract

```ts
// src/strategy/types.ts

export type StrategyMode = 'interval' | 'tick' | 'bar_close';
export type Side = 'LONG' | 'SHORT' | 'WAIT';
export type TickChannel = 'depth-update' | 'new-trade' | 'currentPrices@futures#update';

export interface StrategyManifest {
  id: string;                 // 'smc.rule.v1', 'ma.cross.v1', 'llm.pulse.v1'
  version: string;
  mode: StrategyMode;
  intervalMs?: number;        // required if mode='interval'
  barTimeframes?: string[];   // required if mode='bar_close' (e.g., ['1m','5m','15m'])
  tickChannels?: TickChannel[];
  pairs: string[];            // pairs to evaluate; '*' = all configured pairs
  warmupCandles?: number;     // candles needed at start to be ready
  description: string;
}

export interface StrategyContext {
  ts: number;
  pair: string;
  marketState: MarketState;             // re-exported from src/ai/state-builder.ts
  account: AccountSnapshot;
  recentFills: Fill[];
  trigger:
    | { kind: 'interval' }
    | { kind: 'tick'; channel: TickChannel; raw: any }
    | { kind: 'bar_close'; tf: string };
}

export interface StrategySignal {
  side: Side;
  confidence: number;         // 0..1; clamped post-evaluate
  entry?: string;             // string-typed prices preserve precision
  stopLoss?: string;
  takeProfit?: string;
  reason: string;
  noTradeCondition?: string;  // when side=WAIT
  ttlMs?: number;
  meta?: Record<string, unknown>;
}

export interface Strategy {
  manifest: StrategyManifest;
  warmup?(ctx: { pair: string; candles: Candle[] }): Promise<void> | void;
  evaluate(ctx: StrategyContext): Promise<StrategySignal | null> | StrategySignal | null;
}

export interface RiskFilter {
  filter(signal: StrategySignal, manifest: StrategyManifest, account: AccountSnapshot): StrategySignal | null;
}
```

`MarketState` (currently inferred from `MarketStateBuilder.build` return shape) is promoted to a named export from `src/ai/state-builder.ts` as part of F4.

## Registry

```ts
class StrategyRegistry {
  register(s: Strategy): void;          // validates manifest via zod
  list(): StrategyManifest[];
  get(id: string): Strategy | undefined;
  enable(id: string): void;
  disable(id: string): void;
  performance(id: string): { signalsEmitted: number; lastSignalAt: number; errors: number };
}
```

Per-pair isolation: when a registered strategy declares `pairs.length > 1`, the registry stores one instance per pair (constructed via factory in the manifest or a `clone()` method). Single-pair strategies stored as a single instance.

## Drivers

- **`IntervalDriver`** — `setInterval(intervalMs)` per (strategy, pair). Calls `evaluate` and serializes per pair (drops if previous still pending).
- **`TickDriver`** — subscribes to declared `tickChannels` via `ws.on(...)`. Routes each event to matching (strategy, pair). Per-(strategy, pair) `pending` flag drops events to apply backpressure; counts drops.
- **`BarDriver`** — detects bar boundaries from the existing F2 trade/candle stream. On boundary, runs all `bar_close` strategies whose `barTimeframes` include the closed tf.

All drivers share a `runEvaluation(strategy, pair, trigger)` helper that:
1. Builds `StrategyContext` via `ContextBuilder`.
2. Wraps `evaluate` in a timeout race (`STRATEGY_TIMEOUT_MS`, default 5000).
3. Validates returned signal (zod), clamps confidence.
4. Passes through `riskFilter.filter`.
5. Emits via SignalBus when non-null and side != 'WAIT' (or always, depending on `STRATEGY_EMIT_WAIT` flag, default false).
6. Catches and counts errors; auto-disables strategy after 3 consecutive errors per pair.

## Signal Emission

```ts
const sig: Signal = {
  id: `${manifest.id}:${pair}:${ts}`,
  ts: new Date(ts).toISOString(),
  strategy: manifest.id,
  type: `strategy.${signal.side.toLowerCase()}`,
  pair,
  severity: signal.side === 'WAIT' ? 'info' : (signal.confidence > 0.7 ? 'critical' : 'warn'),
  payload: {
    confidence: signal.confidence,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    reason: signal.reason,
    noTradeCondition: signal.noTradeCondition,
    ttlMs: signal.ttlMs,
    manifestVersion: manifest.version,
  },
};
await signalBus.emit(sig);
```

`WAIT` emission gated by config to avoid Telegram noise; TUI can still subscribe to a separate in-process channel for display.

## Backtester

CLI: `npm run backtest -- --strategy <id> --pair <pair> --from <iso> --to <iso> --source <candles|fills|jsonl> [--tf <tf>] [--out <path>]`

Pipeline:

```
runner({ strategyId, pair, from, to, source, tf, out }):
  registry.register(strategyConstructorById(strategyId))
  dataSource = DataSource.from({ source, pair, from, to, tf })
  simulator = new Simulator({ pair, pessimistic: true })
  for await (const event of dataSource.iterate()):
    simulator.advanceClock(event.ts)
    trigger = derive from event.kind
    ctx = ContextBuilder.fromBacktest({ pair, ts: event.ts, candleWindow: dataSource.window(), accountSnapshot: simulator.snapshot(), trigger })
    raw = await strategy.evaluate(ctx)
    if raw && raw.side !== 'WAIT':
      simulator.applySignal(raw)
    simulator.markToMarket(event.ts, event.price)
  metrics.compute(simulator.tradeLedger())
  tradeLedger.exportCsv(out)
  printSummary({ metrics, coverage: dataSource.coverage() })
```

Simulator rules:
- One open position per pair; new opposite-side signal closes prior + opens new (mirrors observer single-direction view).
- SL/TP triggered when bar high/low crosses level. If both inside one bar, **pessimistic mode** (default) assumes SL hit first; configurable.
- TTL closes signal at expiry if neither SL nor TP hit.

Determinism: simulator uses `event.ts`, never `Date.now()`. No randomness without explicit seed.

## Data Sources

Unified async iterator yielding events `{ ts, kind: 'bar_close'|'tick', price, raw }` and synthetic `gap` events when data missing.

- **`candles`** — REST `getCandles(pair, tf, from, to)` paginated. Yields one `bar_close` event per closed candle. Coverage = received / expected bars.
- **`postgres-fills`** — `SELECT * FROM fills_ledger WHERE pair = $1 AND executed_at BETWEEN $2 AND $3 ORDER BY executed_at`. Yields `tick` per fill. Limited to historically-observed activity.
- **`jsonl`** — read probe captures from `LOG_DIR`. Yields raw frames as `tick`. Highest fidelity, smallest window.

Coverage metric reported in summary: `(yielded_events / expected_events) * 100`.

## Configuration (zod additions)

| Var | Default | Purpose |
|---|---|---|
| `STRATEGY_TIMEOUT_MS` | 5000 | Per-evaluate timeout |
| `STRATEGY_ERROR_THRESHOLD` | 3 | Consecutive errors → auto-disable |
| `STRATEGY_EMIT_WAIT` | false | Emit `strategy.wait` signals to SignalBus |
| `STRATEGY_ENABLED_IDS` | `smc.rule.v1,ma.cross.v1,llm.pulse.v1` | Registered + enabled at startup |
| `STRATEGY_INTERVAL_DEFAULT_MS` | 15000 | Default interval if manifest missing |
| `STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM` | 0.5 | Drop ratio over 60s window to alarm |
| `BACKTEST_PESSIMISTIC` | true | SL-first when ambiguous bar |
| `BACKTEST_OUTPUT_DIR` | `${LOG_DIR}/backtest` | Default CSV output |

## Error Handling

| Failure | Detection | Response |
|---|---|---|
| Strategy `evaluate` throws | try/catch around call | Increment errors; emit `strategy.error` warn; skip; auto-disable after `STRATEGY_ERROR_THRESHOLD` consecutive errors per pair |
| Strategy hang | per-call timeout (`STRATEGY_TIMEOUT_MS`) | Race+timeout; counts as error |
| LLM unreachable | strategy-internal try/catch | Fallback to last-known or `WAIT`; emit `strategy.degraded` (cooldown 5min) |
| Warmup fails | warmup throws or insufficient data | Mark `not_ready`; retry every 60s; emit `strategy.not_ready` |
| Tick backpressure | per-(strategy, pair) `pending` flag | Drop tick + counter; alarm if drop ratio > threshold over 60s |
| Bar-close skew | use `tick.ts`, tolerance ±2s | Skip bar with debug log if no trades in window |
| RiskFilter throws | try/catch | Drop signal; emit `risk.error` warn; pipeline continues |
| Malformed signal | zod validation | Drop + log; counts as error |
| Registry config invalid | startup zod validation | Refuse to start; print clear error |
| Backtest data gap | data-source emits `gap` event | Skip evaluation; coverage metric reflects |
| Backtest SL/TP ambiguity | simulator detects both inside bar | Pessimistic default; configurable |
| State leak across pairs | registry instantiates per-pair instance | Documented in author guide |

### Invariants

- Strategy errors NEVER kill the controller.
- One signal per (strategy, pair) per trigger.
- `confidence` always in `[0, 1]` post-validation.
- Backtester deterministic given (strategy, dataSource, seed).
- `WAIT` signals never trigger backtest trade.

### Read-only Safety

F4 only reads via existing F1/F2/F3 endpoints + Ollama (already used). ReadOnlyGuard unchanged.

### Bounded Resources

- Registry: ≤ 50 strategies × 20 pairs (soft cap; documented).
- Trade ledger: streamed to disk for runs > 1M events; in-memory for smaller.
- F1 SignalBus owns sink rate-limiting (e.g., Telegram).

## Testing

### Unit

- `tests/strategy/registry.test.ts`
- `tests/strategy/scheduler/interval-driver.test.ts`
- `tests/strategy/scheduler/tick-driver.test.ts`
- `tests/strategy/scheduler/bar-driver.test.ts`
- `tests/strategy/context-builder.test.ts`
- `tests/strategy/risk/passthrough.test.ts`
- `tests/strategy/strategies/smc-rule.test.ts`
- `tests/strategy/strategies/ma-cross.test.ts`
- `tests/strategy/strategies/llm-pulse.test.ts` (mock Ollama)
- `tests/strategy/backtest/simulator.test.ts`
- `tests/strategy/backtest/metrics.test.ts`
- `tests/strategy/backtest/data-source.test.ts`
- `tests/strategy/backtest/trade-ledger.test.ts`

### Component

- `tests/strategy/controller.test.ts` — boot warmup; pipeline; error swallowing; auto-disable after threshold.

### Integration (Postgres + mocked WS/Ollama; gated by `SKIP_DOCKER_TESTS=1`)

`tests/strategy/controller.int.test.ts`:
1. Two strategies registered → both signals appear in `signal_log`.
2. Strategy throws → controller stays alive; `strategy.error` row written; 3rd error → `strategy.disabled`.
3. Backtest runner end-to-end via REST candle stub → simulator → metrics; assert PnL and ledger shape.
4. Backtest from `fills_ledger`: pre-seed Postgres, run replay, validate trade count and CSV.

### CLI smoke

`npm run backtest -- --strategy smc.rule.v1 --pair B-BTC_USDT --from 2026-04-01 --to 2026-04-25 --source candles --tf 15m`
- Exits 0
- CSV trade ledger written
- Summary printed: PnL, Sharpe, max drawdown, profit factor, win rate, coverage %

### Quality Gate

`npm run check` (typecheck + lint + tests) green; integration suite gated by Docker.

### Acceptance

- TUI AI panel still populates (LLM strategy preserved through new framework).
- Adding a rule strategy via env config produces signals in `signal_log` and Telegram with strategy id prefix.
- Backtest of a rule strategy on 7 days of 15m candles for 1 pair completes in < 30s.
- Disabling a strategy via env config stops its emission; re-enabling resumes.

## Out of Scope

- Real `RiskFilter` implementation (correlation, drawdown gate) — F5.
- Ensemble strategies combining outputs of multiple strategies — defer (likely F5).
- Walk-forward / cross-validation in backtester — defer.
- Per-strategy persistent state in Postgres — defer; warmup re-fills via REST.
- Order placement — read-only constraint forever.
