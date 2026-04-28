# F3 — Account State Reconciler

**Date:** 2026-04-26
**Status:** Draft for review
**Phase:** 3 of 6
**Depends on:** F1 (config, logger, audit, SignalBus, ReadOnlyGuard, Postgres pool, seq_cursor), F2 (rate-limit token bucket, TimeSync, WsManager reconnect events)

## Hard Constraint

Read-only forever. F3 only calls signed-read endpoints already on the F1 ReadOnlyGuard safe list. No order placement, cancel, or modification. All state-divergence remediation = log + signal + accept exchange truth.

## Goals

Single source of truth for account state, derived from CoinDCX private channels:

- Open positions (with realtime PnL, mark price, leverage)
- Wallet balances (per currency, available + locked)
- Open orders (and full historical order ledger)
- Realized PnL ledger via append-only fills history

Detect and alarm on WS↔REST divergence so the user trusts what the TUI shows. Persist current state + audit changelog so restarts and post-mortem queries work without replaying.

## Decisions (made during brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Scope | Positions + balances + open orders + realized PnL ledger |
| Q2 | Trades source | Hybrid — WS live (`df-trade-update`) + REST sweep backfill |
| Q3 | Persistence model | Current state tables + append-only fills ledger + audit changelog |
| Q4 | Reconcile cadence | WS-first + heartbeat-driven forced sweep + 5-minute drift sweep |
| Q5 | Divergence handling | REST wins + audit + signal; alarm above thresholds |
| Q6 | Realized PnL | Trust exchange `realized_pnl` field per fill |
| Q7 | Signals emitted | Divergence + position lifecycle + threshold alerts + per-fill events |
| Q8 | Orders scope | Full Postgres history with linkage (orders ↔ fills ↔ positions) |
| Q9 | Architecture | Per-entity stores + shared ReconcileController (mirrors F2 pattern) |

## Architecture

```
src/
  account/
    stores/
      position-store.ts       in-mem Map<id, Position>; applyWs / replaceFromRest
      balance-store.ts        Map<currency, Balance>
      order-store.ts          Map<id, Order>; bounded closed-order window
      fills-ledger.ts         ring-buffer + Postgres append; idempotent dedup by id
    reconcile-controller.ts   orchestrator: WS subscribe, REST seed/sweep, persist, signal
    heartbeat-watcher.ts      per-channel staleness floor → forced sweep trigger
    drift-sweeper.ts          5-minute cadence REST sweep loop
    divergence-detector.ts    diff WS-derived snapshot vs REST snapshot; classify severity
    persistence.ts            Postgres upserts + changelog + fills append
    types.ts                  Position, Balance, Order, Fill, AccountSnapshot
```

Wired in `index.ts` runApp:

```ts
const account = new AccountReconcileController(ctx, ws, restApi, signalBus, db);
account.start();
ws.on('df-position-update', raw => account.ingest('position', raw));
ws.on('df-order-update',    raw => account.ingest('order', raw));
ws.on('balance-update',     raw => account.ingest('balance', raw));
ws.on('df-trade-update',    raw => account.ingest('fill', raw));
```

TUI subscribes via `account.snapshot()` getter — replaces direct `state.positions` / `state.balanceMap` / `state.orders` reads in `index.ts:223-313`.

Boundaries:
- **Stores** = pure state, no I/O, no side effects. Easy to unit test.
- **Controller** = the only thing touching WS, REST, signal bus, Postgres, clock.
- **Detector / Sweeper / Heartbeat** = single-purpose helpers composed by controller.

## Components

### stores/position-store.ts

`class PositionStore`. Map<id, Position>.

API:
- `applyWs(parsed)` — upsert; returns `{ prev, next, lifecycle? }` where lifecycle is `'opened'|'closed'|'flipped'|null`.
- `replaceFromRest(rows)` — overwrite; ids missing in REST get `side='flat'` synthesized for one tick (so consumers can detect close), then evicted on next sweep.
- `snapshot()` — array of active (`activePos != 0`) Positions.
- `get(id)`, `all()`.

Lifecycle detection (computed inside `applyWs`):
- `prev.activePos == 0 && next.activePos != 0` → `opened`
- `prev.activePos != 0 && next.activePos == 0` → `closed`
- `sign(prev.activePos) != sign(next.activePos)` and both != 0 → `flipped`

Idempotent: applying same payload twice = same state, no spurious lifecycle event.

### stores/balance-store.ts

`class BalanceStore`. Map<currency, Balance>.

API: `applyWs`, `replaceFromRest`, `snapshot`, `get(currency)`.

Invariant flag: if any row has negative `available` or `locked`, sets `hasViolation=true` for sweeper to act on.

### stores/order-store.ts

`class OrderStore`. Map<id, Order>.

Bounds: keeps closed orders for ≤24h or ≤500 rows (whichever smaller). Active orders unbounded.

API: `applyWs`, `replaceFromRest`, `snapshot()` (open + recent closed), `linkToPosition(orderId, positionId)`.

Status state machine: validates transitions (`open` → `partially_filled` → `filled`), logs warn on regression but does not reject (exchange truth wins).

### stores/fills-ledger.ts

`class FillsLedger`. Ring buffer (1000 rows) + Postgres append.

API:
- `append(fill)` — idempotent via PK conflict ignore on `fills_ledger.id`.
- `backfill(rows, since)` — bulk insert from REST sweep, advances cursor.
- `recent(n)` — for TUI panels.
- `cursor()` — last `executed_at` ingested (persisted in F1 `seq_cursor` table under key `'account.fills'`).

### reconcile-controller.ts

`class AccountReconcileController`. Top-level orchestrator.

Responsibilities:
1. Boot: REST seed all entities, persist initial snapshot, start watchers.
2. Live ingest: route WS events to stores, persist diffs, emit signals, refresh TUI.
3. Heartbeat: schedule forced sweep when channel quiet > floor.
4. Drift sweep: every 5 min, parallel REST fetch + diff + apply + signal.
5. Snapshot getter: composite `AccountSnapshot` for consumers.

Signal kinds emitted (on F1 SignalBus):
- `position.opened`, `position.closed`, `position.flipped`
- `position.pnl_threshold` (when `unrealizedPnl / margin < -ACCOUNT_PNL_ALARM_PCT`)
- `account.margin_util_high` (when `total_locked / total_wallet > ACCOUNT_UTIL_ALARM_PCT`)
- `fill.executed` (every fill, for journaling)
- `reconcile.divergence` (severity included)
- `reconcile.sweep_failed` (REST error after retries)
- `reconcile.storm` (alarm flood suppression summary)
- `account.auth_invalid` (401/403 on REST)
- `account.schema_drift` (unknown WS fields, hourly cooldown)

Cooldown: 5 min per (entity_id, signal_kind) for threshold signals to avoid spam.

### heartbeat-watcher.ts

Per-channel last-event timestamp. Floors:
- positions: 60s
- balances: 60s
- orders: 30s
- fills: 30s

Past floor → emits stale event; controller responds with forced REST sweep for that entity.
On WS reconnect (F2 `WsManager.on('connected')` after disconnect): immediate forced sweep all entities.

### drift-sweeper.ts

Runs every `ACCOUNT_DRIFT_SWEEP_MS` (default 300_000). Skips when F2 token bucket exhausted; defers to next tick. Parallel `Promise.all` REST fetch.

### divergence-detector.ts

`class DivergenceDetector`. Pure compare.

`diff(localSnapshot, restSnapshot, entity)` returns `Diff[]`:
- `{ kind: 'missing_in_local', id, restRow, severity }`
- `{ kind: 'missing_in_rest', id, localRow, severity }`
- `{ kind: 'field_mismatch', id, field, local, rest, severity }`

Classification rules:
- Missing in either → `warn`
- Quantity mismatch (`activePos`, `total_quantity`, `available`, `locked`) → `alarm` (always)
- PnL mismatch: `alarm` if `abs(diff) > ₹100` OR `pct > 1%`; else `warn`
- Other field (e.g. `mark_price`, `leverage`) → `info`

### persistence.ts

Helpers:
- `upsertPosition(row, source)`, `upsertBalance(row, source)`, `upsertOrder(row, source)`
- `appendFill(row, source)` — idempotent
- `recordChangelog(entity, entityId, field, oldVal, newVal, cause, severity)`

Writes batched per ingest; bounded retry buffer (1000 rows) on Postgres failure; oldest dropped if buffer full (in-memory remains source of truth until next sweep).

## Data Model

New migration `00000000000002_account_state.sql` (timestamp tbd at write time):

```sql
CREATE TABLE positions (
  id              TEXT PRIMARY KEY,
  pair            TEXT NOT NULL,
  side            TEXT NOT NULL,
  active_pos      NUMERIC(36,18) NOT NULL,
  avg_price       NUMERIC(36,18) NOT NULL,
  mark_price      NUMERIC(36,18),
  liquidation_price NUMERIC(36,18),
  leverage        NUMERIC(10,2),
  margin_currency TEXT,
  unrealized_pnl  NUMERIC(36,18),
  realized_pnl    NUMERIC(36,18) DEFAULT 0,
  opened_at       TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL
);
CREATE INDEX positions_pair_idx ON positions(pair);

CREATE TABLE balances (
  currency        TEXT PRIMARY KEY,
  available       NUMERIC(36,18) NOT NULL,
  locked          NUMERIC(36,18) NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL
);

CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  pair            TEXT NOT NULL,
  side            TEXT NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL,
  price           NUMERIC(36,18),
  total_quantity  NUMERIC(36,18),
  remaining_qty   NUMERIC(36,18),
  avg_fill_price  NUMERIC(36,18),
  position_id     TEXT REFERENCES positions(id),
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL
);
CREATE INDEX orders_status_idx   ON orders(status);
CREATE INDEX orders_position_idx ON orders(position_id);

CREATE TABLE fills_ledger (
  id              TEXT PRIMARY KEY,
  order_id        TEXT REFERENCES orders(id),
  position_id     TEXT REFERENCES positions(id),
  pair            TEXT NOT NULL,
  side            TEXT NOT NULL,
  price           NUMERIC(36,18) NOT NULL,
  qty             NUMERIC(36,18) NOT NULL,
  fee             NUMERIC(36,18),
  fee_currency    TEXT,
  realized_pnl    NUMERIC(36,18),
  executed_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL
);
CREATE INDEX fills_executed_idx ON fills_ledger(executed_at);
CREATE INDEX fills_pair_idx     ON fills_ledger(pair);

CREATE TABLE account_changelog (
  id              BIGSERIAL PRIMARY KEY,
  entity          TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  field           TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  cause           TEXT NOT NULL,
  severity        TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX changelog_entity_idx   ON account_changelog(entity, entity_id);
CREATE INDEX changelog_recorded_idx ON account_changelog(recorded_at);
```

Retention of `fills_ledger` and `account_changelog` is out of scope for F3 (operational concern; tracked separately).

### Types (`src/account/types.ts`)

```ts
export type Side = 'long' | 'short' | 'flat';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
export type Source = 'ws' | 'rest' | 'ws_skewed';

export interface Position {
  id: string; pair: string; side: Side;
  activePos: string; avgPrice: string; markPrice?: string;
  liquidationPrice?: string; leverage?: string;
  marginCurrency: string; unrealizedPnl: string; realizedPnl: string;
  openedAt?: string; updatedAt: string; source: Source;
}
export interface Balance { currency: string; available: string; locked: string; updatedAt: string; source: Source; }
export interface Order   { id: string; pair: string; side: 'buy'|'sell'; type: string; status: OrderStatus;
  price?: string; totalQty: string; remainingQty: string; avgFillPrice?: string;
  positionId?: string; createdAt: string; updatedAt: string; source: Source; }
export interface Fill    { id: string; orderId?: string; positionId?: string;
  pair: string; side: 'buy'|'sell'; price: string; qty: string;
  fee?: string; feeCurrency?: string; realizedPnl?: string;
  executedAt: string; ingestedAt: string; source: Source; }

export interface AccountSnapshot {
  positions: Position[]; balances: Balance[]; orders: Order[];
  totals: { equityInr: string; walletInr: string; unrealizedInr: string;
            realizedDay: string; realizedLifetime: string };
}
```

All numeric fields are strings to preserve exchange-precision (matches existing repo convention; no float drift).

## Data Flow

### Boot

1. `controller.start()`
2. Parallel REST seed: `getFuturesPositions` (existing), `getFuturesWallets` (existing as `getBalances`), `getOpenOrders` (new), `getFuturesTrades(since=cursor)` (new).
3. Stores call `replaceFromRest`. FillsLedger calls `backfill`.
4. Persist initial snapshot to Postgres (upsert + append).
5. Subscribe to WS channels via existing `WsManager`.
6. Start `HeartbeatWatcher` and `DriftSweeper` timers.

If `seq_cursor['account.fills']` missing or invalid: cold-start backfills last 24h; PK conflicts on re-insert ignored (idempotent).

### Live ingest path (per WS event)

```
ws.on('df-X-update', raw):
  controller.ingest('X', raw)
    parse + zod-validate (passthrough unknown fields, warn-once per field)
    store.applyWs(parsed) → { prev, next, lifecycle? }
    heartbeat.touch('X')
    persistence.upsert(...)
    persistence.recordChangelog(diff fields, cause='ws_apply', severity=null)
    if lifecycle: signalBus.emit(`position.${lifecycle}`, ...)
    threshold checks → maybe emit pnl/util signals (with cooldown)
    if entity == 'fill': fillsLedger.append + signalBus.emit('fill.executed', ...)
    tui.refresh()
```

### Forced sweep (heartbeat or reconnect)

Targeted REST fetch for the stale entity → `replaceFromRest` → diff via `DivergenceDetector` → persist + signal each diff.

### Drift sweep (5 min)

Parallel REST fetch all four entities → diff → classify → persist + signal. For fills: append-new only (diff by id set).

### Linkage (orders ↔ fills ↔ positions)

`Fill.orderId` from WS payload. `Fill.positionId` resolved via `OrderStore.get(orderId)?.positionId`. If unresolved (boot race): orphan queue, retry once after 5s, accept null otherwise. Reconciler 5-min sweep retroactively links via REST data.

`Order.positionId` set on first matched fill (lookup by pair + side direction in active positions); persisted lazily on next upsert.

## Error Handling

| Failure | Detection | Response |
|---|---|---|
| WS disconnect | `WsManager.on('disconnected')` (F2) | Mark all heartbeats stale; on reconnect → forced sweep all entities |
| WS payload parse fail | `safeParse` null OR zod throw | Log warn; counter `account.parse_errors{entity}`; drop event; REST will reconcile |
| WS schema drift (unknown field) | `.passthrough()` warn-once | Continue with parsed subset; `account.schema_drift` signal hourly cooldown |
| REST 5xx / network | axios retry | Exponential backoff max 3; final fail → `reconcile.sweep_failed` (warn); keep last good state |
| REST 401/403 | axios interceptor | Disable F3 ingest; emit `account.auth_invalid` (alarm); TUI shows existing `No API key` rows |
| REST 429 | response status | F2 token bucket; defer sweep to next tick |
| Postgres write fail | pg pool error | Bounded retry buffer (1000 rows); oldest dropped if full; in-memory remains source of truth |
| Clock skew (F2 alarm) | `ctx.timeSync.skewExceeded` | Don't trust WS timestamps for `executed_at`; fall back to local `Date.now()`; mark `source='ws_skewed'` |
| Resume cursor corruption | seq_cursor missing/invalid | Cold-start: backfill last 24h; PK conflict ignored |
| Orphan fill | `OrderStore.get(orderId) == null` | Queue 5s, retry once; else null link; sweep links retroactively |
| Divergence flood | >N alarms in M seconds | Suppress further alarms; emit `reconcile.storm` summary; resume after quiet period |
| Position closed during partial fill race | local has `activePos != 0`, REST missing | Treat as closed: synthesize `position.closed` (source=`rest`), changelog `severity=warn` |

### Invariants

- `positions.active_pos == 0` ↔ in-memory row has `side='flat'`; Postgres row preserved for history.
- `orders.remaining_qty + filled_qty == total_quantity` (within epsilon); violation → log + sweep.
- `fills_ledger.id` unique (PK); duplicate insert no-op (at-least-once WS delivery).
- `balances.available >= 0`, `balances.locked >= 0`; negative → REST sweep + alarm.

### Read-only Safety

Only signed-read endpoints used: `/exchange/v1/derivatives/futures/positions` (existing in `coindcx-api.ts`), `/exchange/v1/derivatives/futures/wallets` (existing), `/exchange/v1/derivatives/futures/orders` with status filter (new gateway method, GET), `/exchange/v1/derivatives/futures/trades` (new gateway method, signed-read POST). New methods land in `src/gateways/coindcx-api.ts`. All four added to F1 ReadOnlyGuard signed-read allowlist if not already covered by existing GET passthrough.

### Bounded Resources

- `OrderStore`: closed orders ≤24h or ≤500 rows.
- Fills ring-buffer: 1000 in-memory; Postgres = full history.
- Retry buffer: 1000 rows max.

## Configuration (env / zod schema)

| Var | Default | Purpose |
|---|---|---|
| `ACCOUNT_DRIFT_SWEEP_MS` | 300_000 | Drift sweep interval |
| `ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS` | 60_000 | Per-channel staleness floor |
| `ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS` | 60_000 | |
| `ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS` | 30_000 | |
| `ACCOUNT_HEARTBEAT_FLOOR_FILL_MS` | 30_000 | |
| `ACCOUNT_PNL_ALARM_PCT` | -0.10 | Position pnl/margin threshold for alarm |
| `ACCOUNT_UTIL_ALARM_PCT` | 0.90 | Margin util alarm threshold |
| `ACCOUNT_DIVERGENCE_PNL_ABS_INR` | 100 | Divergence alarm absolute floor |
| `ACCOUNT_DIVERGENCE_PNL_PCT` | 0.01 | Divergence alarm relative threshold |
| `ACCOUNT_BACKFILL_HOURS` | 24 | Cold-start fills backfill window |
| `ACCOUNT_SIGNAL_COOLDOWN_MS` | 300_000 | Per (entity, kind) cooldown |
| `ACCOUNT_STORM_THRESHOLD` | 20 | Alarms in window to trigger storm |
| `ACCOUNT_STORM_WINDOW_MS` | 60_000 | Storm window |

## Testing

### Unit (per store, pure logic)

- `tests/account/stores/position-store.test.ts`: upsert, replaceFromRest with synthesized flat, lifecycle detection (open/close/flip), idempotent re-apply.
- `tests/account/stores/order-store.test.ts`: status transitions, closed-order eviction at cap, `linkToPosition`.
- `tests/account/stores/balance-store.test.ts`: WS upsert per currency, negative-balance violation flag.
- `tests/account/fills-ledger.test.ts`: idempotent append, backfill merge, monotonic cursor.

### Component (controller helpers, mocked deps)

- `divergence-detector.test.ts`: classification rules per field type and severity table.
- `heartbeat-watcher.test.ts`: touch resets timer; past-floor emits stale; channels independent.
- `drift-sweeper.test.ts`: fake timers schedule; skip when bucket exhausted; parallel fetch.

### Integration (real Postgres, mock WS + REST; gated by `SKIP_DOCKER_TESTS=1`)

`tests/account/reconcile-controller.int.test.ts`:

1. Boot seed → live WS merge.
2. WS-only flow: heartbeat fresh, no forced sweep.
3. WS gap → forced sweep on stale floor; divergence detected; changelog written.
4. Divergence alarm path: WS qty=10 vs REST qty=0 → alarm signal, REST wins, synthesized `position.closed`.
5. Fill ingest + linkage retroactive.
6. Resume from cursor: pre-seeded fills + cursor; no duplicates.
7. Idempotent re-ingest: replay 3× → 1 changelog row, 1 signal.
8. Auth fail: 401 → controller stops, `account.auth_invalid`, in-memory preserved.

### Probe / Manual

`npm run probe:account -- --duration 60` — subscribes account channels, logs raw + parsed frames, dumps final snapshot vs Postgres diff. Used to verify CoinDCX field shapes against zod schemas.

### TUI Verification

Replace direct state reads in `index.ts:223-313` with `account.snapshot()`. Existing rendering unchanged. Acceptance: bot running 1h, TUI matches CoinDCX web UI exactly.

### Quality Gate

`npm run check` (typecheck + lint + tests) passes. Integration suite gated by Docker as in F2.

## Out of Scope

- Local FIFO realized-PnL recomputation (additive future work).
- Postgres retention policies for `fills_ledger` / `account_changelog`.
- Strategy/signal consumption of account state (F4).
- Risk-alert engine atop account thresholds (F5).
- Backtester replay using fills + book history (F4/F6).
- Order placement, cancellation, modification — read-only constraint forever.
