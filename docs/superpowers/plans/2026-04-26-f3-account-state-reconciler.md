# F3 — Account State Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single source of truth for account state (positions, balances, orders, fills) merging WS live updates with REST sweeps, persisting current state + audit changelog + fills ledger to Postgres, emitting lifecycle/divergence/threshold signals on the F1 SignalBus, and feeding a snapshot getter that replaces direct state reads in `index.ts`.

**Architecture:** Per-entity in-memory stores + a shared `AccountReconcileController`. WS-first ingest with heartbeat-driven forced sweeps and a 5-minute drift sweep. Divergence detector classifies REST↔local diffs into info/warn/alarm and emits signals. Read-only forever — only signed-read endpoints used.

**Tech Stack:** TypeScript, zod, axios, pg, node-pg-migrate, vitest, blessed (existing TUI), F1 SignalBus + ReadOnlyGuard, F2 RestBudget + WsManager.

**Reference:** `docs/superpowers/specs/2026-04-26-f3-account-state-reconciler-design.md`

---

## File Structure

**New:**
- `src/db/migrations/<ts>_account_state.js` — positions, balances, orders, fills_ledger, account_changelog tables
- `src/account/types.ts` — Position, Balance, Order, Fill, AccountSnapshot, Source, Side, OrderStatus
- `src/account/stores/position-store.ts` — Map<id,Position>, applyWs, replaceFromRest, lifecycle detection
- `src/account/stores/balance-store.ts` — Map<currency,Balance>, applyWs, replaceFromRest, invariant flag
- `src/account/stores/order-store.ts` — Map<id,Order>, status state machine, closed-order eviction
- `src/account/stores/fills-ledger.ts` — ring buffer + idempotent Postgres append + cursor
- `src/account/divergence-detector.ts` — pure diff function with severity classification
- `src/account/heartbeat-watcher.ts` — per-channel last-event timestamps, stale-event emission
- `src/account/drift-sweeper.ts` — 5-min cadence REST sweep loop integrated with rate-limit budget
- `src/account/persistence.ts` — Postgres upserts + changelog + fills append + retry buffer
- `src/account/reconcile-controller.ts` — orchestrator: WS subscribe, REST seed/sweep, persist, signal, snapshot
- `src/cli/probe-account.ts` — probe entrypoint for raw account-channel frame capture
- `tests/account/stores/position-store.test.ts`
- `tests/account/stores/balance-store.test.ts`
- `tests/account/stores/order-store.test.ts`
- `tests/account/stores/fills-ledger.test.ts`
- `tests/account/divergence-detector.test.ts`
- `tests/account/heartbeat-watcher.test.ts`
- `tests/account/drift-sweeper.test.ts`
- `tests/account/reconcile-controller.int.test.ts`

**Modified:**
- `src/gateways/coindcx-api.ts` — add `getOpenOrders`, `getFuturesTradeHistory`
- `src/safety/read-only-guard.ts` — confirm `/futures/trade_history` already on allowlist (it is); no change unless verification fails
- `src/config/schema.ts` — add F3 env vars
- `src/index.ts` — instantiate controller, wire WS, replace direct state reads in `refreshPositionsDisplay`/`refreshBalanceDisplay`/`refreshOrdersDisplay` with `account.snapshot()`
- `package.json` — `probe:account` script
- `README.md` — phase status (move F2 to shipped, F3 to current)

---

## Task 1: Add F3 config vars

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/config/schema.test.ts` (extend existing if present, else create minimal)

- [ ] **Step 1: Add failing test asserting defaults**

In `tests/config/schema.test.ts`, append:

```ts
import { ConfigSchema } from '../../src/config/schema';

describe('F3 account config defaults', () => {
  const base = {
    PG_URL: 'postgres://x', COINDCX_API_KEY: 'k', COINDCX_API_SECRET: 's', LOG_DIR: '/tmp',
  };
  it('parses with F3 defaults', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.ACCOUNT_DRIFT_SWEEP_MS).toBe(300_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS).toBe(60_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS).toBe(60_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS).toBe(30_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_FILL_MS).toBe(30_000);
    expect(cfg.ACCOUNT_PNL_ALARM_PCT).toBe(-0.10);
    expect(cfg.ACCOUNT_UTIL_ALARM_PCT).toBe(0.90);
    expect(cfg.ACCOUNT_DIVERGENCE_PNL_ABS_INR).toBe(100);
    expect(cfg.ACCOUNT_DIVERGENCE_PNL_PCT).toBe(0.01);
    expect(cfg.ACCOUNT_BACKFILL_HOURS).toBe(24);
    expect(cfg.ACCOUNT_SIGNAL_COOLDOWN_MS).toBe(300_000);
    expect(cfg.ACCOUNT_STORM_THRESHOLD).toBe(20);
    expect(cfg.ACCOUNT_STORM_WINDOW_MS).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: FAIL — properties undefined.

- [ ] **Step 3: Add the env vars to ConfigSchema**

In `src/config/schema.ts`, add inside the `z.object({ ... })` block before the closing `})`:

```ts
  // F3 Account Reconciler
  ACCOUNT_DRIFT_SWEEP_MS: z.coerce.number().int().positive().default(300_000),
  ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS: z.coerce.number().int().positive().default(60_000),
  ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS: z.coerce.number().int().positive().default(60_000),
  ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS: z.coerce.number().int().positive().default(30_000),
  ACCOUNT_HEARTBEAT_FLOOR_FILL_MS: z.coerce.number().int().positive().default(30_000),
  ACCOUNT_PNL_ALARM_PCT: z.coerce.number().default(-0.10),
  ACCOUNT_UTIL_ALARM_PCT: z.coerce.number().default(0.90),
  ACCOUNT_DIVERGENCE_PNL_ABS_INR: z.coerce.number().default(100),
  ACCOUNT_DIVERGENCE_PNL_PCT: z.coerce.number().default(0.01),
  ACCOUNT_BACKFILL_HOURS: z.coerce.number().int().positive().default(24),
  ACCOUNT_SIGNAL_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  ACCOUNT_STORM_THRESHOLD: z.coerce.number().int().positive().default(20),
  ACCOUNT_STORM_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(f3): add account reconciler config vars"
```

---

## Task 2: Add Postgres migration for account state tables

**Files:**
- Create: `src/db/migrations/1714000000001_account_state.js`

- [ ] **Step 1: Create migration file**

Create `src/db/migrations/1714000000001_account_state.js`:

```js
/* eslint-disable camelcase */
exports.up = pgm => {
  pgm.sql(`
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
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP TABLE IF EXISTS account_changelog;
    DROP TABLE IF EXISTS fills_ledger;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS balances;
    DROP TABLE IF EXISTS positions;
  `);
};
```

- [ ] **Step 2: Run migration against local Postgres**

Start Postgres: `docker compose up -d`
Run: `npm run db:migrate`
Expected: Output ends with "Migrations complete!" and lists `1714000000001_account_state` as applied.

- [ ] **Step 3: Verify schema**

Run: `docker compose exec postgres psql -U postgres -d coindcx -c '\dt'`
Expected: rows for `positions`, `balances`, `orders`, `fills_ledger`, `account_changelog` plus pre-existing F1 tables.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/1714000000001_account_state.js
git commit -m "feat(f3): add account state migration (positions/balances/orders/fills/changelog)"
```

---

## Task 3: Add account types module

**Files:**
- Create: `src/account/types.ts`

- [ ] **Step 1: Write the file**

Create `src/account/types.ts`:

```ts
export type Side = 'long' | 'short' | 'flat';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
export type Source = 'ws' | 'rest' | 'ws_skewed';
export type Entity = 'position' | 'balance' | 'order' | 'fill';

export interface Position {
  id: string;
  pair: string;
  side: Side;
  activePos: string;
  avgPrice: string;
  markPrice?: string;
  liquidationPrice?: string;
  leverage?: string;
  marginCurrency: string;
  unrealizedPnl: string;
  realizedPnl: string;
  openedAt?: string;
  updatedAt: string;
  source: Source;
}

export interface Balance {
  currency: string;
  available: string;
  locked: string;
  updatedAt: string;
  source: Source;
}

export interface Order {
  id: string;
  pair: string;
  side: OrderSide;
  type: string;
  status: OrderStatus;
  price?: string;
  totalQty: string;
  remainingQty: string;
  avgFillPrice?: string;
  positionId?: string;
  createdAt: string;
  updatedAt: string;
  source: Source;
}

export interface Fill {
  id: string;
  orderId?: string;
  positionId?: string;
  pair: string;
  side: OrderSide;
  price: string;
  qty: string;
  fee?: string;
  feeCurrency?: string;
  realizedPnl?: string;
  executedAt: string;
  ingestedAt: string;
  source: Source;
}

export interface AccountTotals {
  equityInr: string;
  walletInr: string;
  unrealizedInr: string;
  realizedDay: string;
  realizedLifetime: string;
}

export interface AccountSnapshot {
  positions: Position[];
  balances: Balance[];
  orders: Order[];
  totals: AccountTotals;
}

export type Lifecycle = 'opened' | 'closed' | 'flipped' | null;

export interface ApplyResult<T> {
  prev: T | null;
  next: T;
  changedFields: string[];
}

export interface PositionApplyResult extends ApplyResult<Position> {
  lifecycle: Lifecycle;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/account/types.ts
git commit -m "feat(f3): add account types"
```

---

## Task 4: PositionStore — failing test

**Files:**
- Create: `tests/account/stores/position-store.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/account/stores/position-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PositionStore } from '../../../src/account/stores/position-store';
import type { Position } from '../../../src/account/types';

const base: Position = {
  id: 'p1', pair: 'B-BTC_USDT', side: 'long',
  activePos: '0.5', avgPrice: '50000', markPrice: '50100',
  marginCurrency: 'USDT', unrealizedPnl: '50', realizedPnl: '0',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

describe('PositionStore', () => {
  it('upserts on applyWs and reports changedFields', () => {
    const s = new PositionStore();
    const r1 = s.applyWs(base);
    expect(r1.prev).toBeNull();
    expect(r1.next.id).toBe('p1');
    expect(r1.lifecycle).toBe('opened');

    const r2 = s.applyWs({ ...base, markPrice: '51000', unrealizedPnl: '500' });
    expect(r2.prev?.markPrice).toBe('50100');
    expect(r2.next.markPrice).toBe('51000');
    expect(r2.changedFields).toEqual(expect.arrayContaining(['markPrice', 'unrealizedPnl']));
    expect(r2.lifecycle).toBeNull();
  });

  it('emits closed lifecycle when activePos goes to 0', () => {
    const s = new PositionStore();
    s.applyWs(base);
    const r = s.applyWs({ ...base, activePos: '0', side: 'flat' });
    expect(r.lifecycle).toBe('closed');
  });

  it('emits flipped lifecycle when sign changes without zero crossing', () => {
    const s = new PositionStore();
    s.applyWs(base);
    const r = s.applyWs({ ...base, activePos: '-0.3', side: 'short' });
    expect(r.lifecycle).toBe('flipped');
  });

  it('replaceFromRest synthesizes flat for ids missing in REST', () => {
    const s = new PositionStore();
    s.applyWs(base);
    s.applyWs({ ...base, id: 'p2' });
    const restOnlyP1 = [{ ...base, activePos: '0.7', source: 'rest' as const }];
    const result = s.replaceFromRest(restOnlyP1);
    expect(result.synthesizedFlat).toEqual(['p2']);
    expect(s.get('p1')?.activePos).toBe('0.7');
    expect(s.get('p2')?.side).toBe('flat');
    expect(s.get('p2')?.activePos).toBe('0');
  });

  it('snapshot returns only active (activePos != 0)', () => {
    const s = new PositionStore();
    s.applyWs(base);
    s.applyWs({ ...base, id: 'p2', activePos: '0', side: 'flat' });
    expect(s.snapshot().map(p => p.id)).toEqual(['p1']);
  });

  it('idempotent re-apply emits no lifecycle event after first', () => {
    const s = new PositionStore();
    s.applyWs(base);
    const r = s.applyWs(base);
    expect(r.lifecycle).toBeNull();
    expect(r.changedFields).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/stores/position-store.test.ts`
Expected: FAIL — `Cannot find module '...position-store'`.

- [ ] **Step 3: Implement PositionStore**

Create `src/account/stores/position-store.ts`:

```ts
import type { Position, PositionApplyResult, Side } from '../types';

const TRACKED_FIELDS: (keyof Position)[] = [
  'pair', 'side', 'activePos', 'avgPrice', 'markPrice', 'liquidationPrice',
  'leverage', 'marginCurrency', 'unrealizedPnl', 'realizedPnl', 'openedAt',
];

function diffFields(prev: Position | null, next: Position): string[] {
  if (!prev) return ['*'];
  const changed: string[] = [];
  for (const k of TRACKED_FIELDS) {
    if (prev[k] !== next[k]) changed.push(k);
  }
  return changed;
}

function classifyLifecycle(prev: Position | null, next: Position): PositionApplyResult['lifecycle'] {
  const prevQty = prev ? Number(prev.activePos) : 0;
  const nextQty = Number(next.activePos);
  if (prevQty === 0 && nextQty !== 0) return 'opened';
  if (prevQty !== 0 && nextQty === 0) return 'closed';
  if (prevQty !== 0 && nextQty !== 0 && Math.sign(prevQty) !== Math.sign(nextQty)) return 'flipped';
  return null;
}

function flatten(p: Position): Position {
  return { ...p, side: 'flat' as Side, activePos: '0' };
}

export class PositionStore {
  private map = new Map<string, Position>();

  applyWs(next: Position): PositionApplyResult {
    const prev = this.map.get(next.id) ?? null;
    const lifecycle = classifyLifecycle(prev, next);
    const changedFields = diffFields(prev, next);
    this.map.set(next.id, next);
    return { prev, next, lifecycle, changedFields };
  }

  replaceFromRest(rows: Position[]): { synthesizedFlat: string[]; applied: Position[] } {
    const restIds = new Set(rows.map(r => r.id));
    const synthesizedFlat: string[] = [];
    for (const [id, existing] of this.map) {
      if (!restIds.has(id) && Number(existing.activePos) !== 0) {
        this.map.set(id, flatten(existing));
        synthesizedFlat.push(id);
      }
    }
    for (const r of rows) this.map.set(r.id, r);
    return { synthesizedFlat, applied: rows };
  }

  snapshot(): Position[] {
    return Array.from(this.map.values()).filter(p => Number(p.activePos) !== 0);
  }

  get(id: string): Position | undefined {
    return this.map.get(id);
  }

  all(): Position[] {
    return Array.from(this.map.values());
  }

  evictFlat(): string[] {
    const evicted: string[] = [];
    for (const [id, p] of this.map) {
      if (p.side === 'flat' && Number(p.activePos) === 0) {
        this.map.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/stores/position-store.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/stores/position-store.ts tests/account/stores/position-store.test.ts
git commit -m "feat(f3): PositionStore with lifecycle detection and flat synthesis"
```

---

## Task 5: BalanceStore

**Files:**
- Create: `src/account/stores/balance-store.ts`
- Create: `tests/account/stores/balance-store.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/stores/balance-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BalanceStore } from '../../../src/account/stores/balance-store';
import type { Balance } from '../../../src/account/types';

const usdt: Balance = {
  currency: 'USDT', available: '100', locked: '50',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

describe('BalanceStore', () => {
  it('upserts per currency', () => {
    const s = new BalanceStore();
    s.applyWs(usdt);
    expect(s.get('USDT')?.available).toBe('100');
    s.applyWs({ ...usdt, available: '120' });
    expect(s.get('USDT')?.available).toBe('120');
  });

  it('replaceFromRest overwrites all rows', () => {
    const s = new BalanceStore();
    s.applyWs(usdt);
    s.applyWs({ ...usdt, currency: 'INR', available: '5000', locked: '0' });
    s.replaceFromRest([{ ...usdt, available: '999' }]);
    expect(s.get('USDT')?.available).toBe('999');
    expect(s.get('INR')).toBeUndefined();
  });

  it('flags violation when balance is negative', () => {
    const s = new BalanceStore();
    s.applyWs({ ...usdt, available: '-1' });
    expect(s.hasViolation()).toBe(true);
  });

  it('clears violation flag after sweep', () => {
    const s = new BalanceStore();
    s.applyWs({ ...usdt, available: '-1' });
    s.replaceFromRest([usdt]);
    expect(s.hasViolation()).toBe(false);
  });

  it('snapshot returns all balances', () => {
    const s = new BalanceStore();
    s.applyWs(usdt);
    expect(s.snapshot()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/stores/balance-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement BalanceStore**

Create `src/account/stores/balance-store.ts`:

```ts
import type { Balance } from '../types';

export class BalanceStore {
  private map = new Map<string, Balance>();
  private violation = false;

  applyWs(next: Balance): { prev: Balance | null; next: Balance; changedFields: string[] } {
    const prev = this.map.get(next.currency) ?? null;
    this.map.set(next.currency, next);
    this.recomputeViolation();
    const changed = !prev ? ['*'] : (['available', 'locked'] as const).filter(k => prev[k] !== next[k]);
    return { prev, next, changedFields: changed };
  }

  replaceFromRest(rows: Balance[]): void {
    this.map.clear();
    for (const r of rows) this.map.set(r.currency, r);
    this.recomputeViolation();
  }

  get(currency: string): Balance | undefined {
    return this.map.get(currency);
  }

  snapshot(): Balance[] {
    return Array.from(this.map.values());
  }

  hasViolation(): boolean {
    return this.violation;
  }

  private recomputeViolation(): void {
    this.violation = false;
    for (const b of this.map.values()) {
      if (Number(b.available) < 0 || Number(b.locked) < 0) {
        this.violation = true;
        return;
      }
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/stores/balance-store.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/stores/balance-store.ts tests/account/stores/balance-store.test.ts
git commit -m "feat(f3): BalanceStore with negative-balance violation flag"
```

---

## Task 6: OrderStore

**Files:**
- Create: `src/account/stores/order-store.ts`
- Create: `tests/account/stores/order-store.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/stores/order-store.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { OrderStore } from '../../../src/account/stores/order-store';
import type { Order } from '../../../src/account/types';

const base: Order = {
  id: 'o1', pair: 'B-BTC_USDT', side: 'buy', type: 'limit', status: 'open',
  price: '50000', totalQty: '0.5', remainingQty: '0.5',
  createdAt: '2026-04-26T00:00:00Z', updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

describe('OrderStore', () => {
  it('upserts on applyWs', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500 });
    s.applyWs(base);
    expect(s.get('o1')?.status).toBe('open');
    s.applyWs({ ...base, status: 'partially_filled', remainingQty: '0.3' });
    expect(s.get('o1')?.status).toBe('partially_filled');
  });

  it('logs warn but accepts regression (filled -> open)', () => {
    const warn = vi.fn();
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500, onRegression: warn });
    s.applyWs({ ...base, status: 'filled' });
    s.applyWs({ ...base, status: 'open' });
    expect(warn).toHaveBeenCalledWith({ id: 'o1', from: 'filled', to: 'open' });
    expect(s.get('o1')?.status).toBe('open');
  });

  it('evicts closed orders past TTL', () => {
    let now = 1_000_000;
    const clock = () => now;
    const s = new OrderStore({ closedTtlMs: 1000, closedMax: 500, clock });
    s.applyWs({ ...base, status: 'filled', updatedAt: new Date(now).toISOString() });
    now += 2000;
    s.evictExpired();
    expect(s.get('o1')).toBeUndefined();
  });

  it('evicts oldest closed when over closedMax', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 2 });
    for (let i = 0; i < 5; i++) {
      s.applyWs({ ...base, id: `o${i}`, status: 'filled', updatedAt: `2026-04-26T00:00:0${i}Z` });
    }
    s.evictExpired();
    const ids = s.snapshot().map(o => o.id).sort();
    expect(ids.length).toBe(2);
    expect(ids).toEqual(['o3', 'o4']);
  });

  it('linkToPosition updates row', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500 });
    s.applyWs(base);
    s.linkToPosition('o1', 'pos1');
    expect(s.get('o1')?.positionId).toBe('pos1');
  });

  it('replaceFromRest replaces only open orders, preserves closed history window', () => {
    const s = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500 });
    s.applyWs({ ...base, id: 'oOpen' });
    s.applyWs({ ...base, id: 'oClosed', status: 'filled' });
    s.replaceFromRest([{ ...base, id: 'oNew' }]);
    expect(s.get('oOpen')).toBeUndefined();
    expect(s.get('oClosed')?.status).toBe('filled');
    expect(s.get('oNew')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/stores/order-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OrderStore**

Create `src/account/stores/order-store.ts`:

```ts
import type { Order, OrderStatus } from '../types';

const CLOSED_STATUSES = new Set<OrderStatus>(['filled', 'cancelled', 'rejected']);
const RANK: Record<OrderStatus, number> = {
  open: 0, partially_filled: 1, filled: 2, cancelled: 2, rejected: 2,
};

export interface OrderStoreOptions {
  closedTtlMs: number;
  closedMax: number;
  clock?: () => number;
  onRegression?: (info: { id: string; from: OrderStatus; to: OrderStatus }) => void;
}

export class OrderStore {
  private map = new Map<string, Order>();
  private clock: () => number;

  constructor(private opts: OrderStoreOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  applyWs(next: Order): { prev: Order | null; next: Order; changedFields: string[] } {
    const prev = this.map.get(next.id) ?? null;
    if (prev && RANK[prev.status] > RANK[next.status]) {
      this.opts.onRegression?.({ id: next.id, from: prev.status, to: next.status });
    }
    const changed = !prev
      ? ['*']
      : (['status', 'remainingQty', 'avgFillPrice', 'price', 'positionId'] as const)
          .filter(k => prev[k] !== next[k]);
    this.map.set(next.id, next);
    return { prev, next, changedFields: changed };
  }

  replaceFromRest(openRows: Order[]): void {
    for (const [id, o] of Array.from(this.map)) {
      if (!CLOSED_STATUSES.has(o.status)) this.map.delete(id);
    }
    for (const r of openRows) this.map.set(r.id, r);
  }

  linkToPosition(orderId: string, positionId: string): void {
    const o = this.map.get(orderId);
    if (o) this.map.set(orderId, { ...o, positionId });
  }

  get(id: string): Order | undefined {
    return this.map.get(id);
  }

  snapshot(): Order[] {
    return Array.from(this.map.values());
  }

  evictExpired(): string[] {
    const now = this.clock();
    const evicted: string[] = [];
    const closed: Order[] = [];
    for (const [id, o] of this.map) {
      if (CLOSED_STATUSES.has(o.status)) {
        const age = now - new Date(o.updatedAt).getTime();
        if (age > this.opts.closedTtlMs) {
          this.map.delete(id);
          evicted.push(id);
        } else {
          closed.push(o);
        }
      }
    }
    if (closed.length > this.opts.closedMax) {
      closed.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const overflow = closed.slice(0, closed.length - this.opts.closedMax);
      for (const o of overflow) {
        this.map.delete(o.id);
        evicted.push(o.id);
      }
    }
    return evicted;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/stores/order-store.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/stores/order-store.ts tests/account/stores/order-store.test.ts
git commit -m "feat(f3): OrderStore with closed-order eviction and linkage"
```

---

## Task 7: FillsLedger

**Files:**
- Create: `src/account/stores/fills-ledger.ts`
- Create: `tests/account/stores/fills-ledger.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/stores/fills-ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FillsLedger } from '../../../src/account/stores/fills-ledger';
import type { Fill } from '../../../src/account/types';

const f1: Fill = {
  id: 'f1', pair: 'B-BTC_USDT', side: 'buy',
  price: '50000', qty: '0.1', realizedPnl: '0',
  executedAt: '2026-04-26T00:00:00Z', ingestedAt: '2026-04-26T00:00:01Z', source: 'ws',
};

describe('FillsLedger', () => {
  it('append is idempotent by id', () => {
    const l = new FillsLedger({ ringSize: 100 });
    expect(l.append(f1)).toBe(true);
    expect(l.append(f1)).toBe(false);
    expect(l.recent(10)).toHaveLength(1);
  });

  it('cursor advances to max executedAt seen', () => {
    const l = new FillsLedger({ ringSize: 100 });
    l.append({ ...f1, id: 'a', executedAt: '2026-04-26T00:00:00Z' });
    l.append({ ...f1, id: 'b', executedAt: '2026-04-26T01:00:00Z' });
    l.append({ ...f1, id: 'c', executedAt: '2026-04-26T00:30:00Z' });
    expect(l.cursor()).toBe('2026-04-26T01:00:00Z');
  });

  it('recent returns most recent N in chronological order', () => {
    const l = new FillsLedger({ ringSize: 100 });
    l.append({ ...f1, id: 'a', executedAt: '2026-04-26T00:00:00Z' });
    l.append({ ...f1, id: 'b', executedAt: '2026-04-26T00:01:00Z' });
    l.append({ ...f1, id: 'c', executedAt: '2026-04-26T00:02:00Z' });
    expect(l.recent(2).map(x => x.id)).toEqual(['b', 'c']);
  });

  it('ring evicts oldest when over capacity', () => {
    const l = new FillsLedger({ ringSize: 2 });
    l.append({ ...f1, id: 'a', executedAt: '2026-04-26T00:00:00Z' });
    l.append({ ...f1, id: 'b', executedAt: '2026-04-26T00:01:00Z' });
    l.append({ ...f1, id: 'c', executedAt: '2026-04-26T00:02:00Z' });
    expect(l.recent(10).map(x => x.id)).toEqual(['b', 'c']);
  });

  it('knownIds reflects ring contents', () => {
    const l = new FillsLedger({ ringSize: 2 });
    l.append({ ...f1, id: 'a' });
    l.append({ ...f1, id: 'b' });
    l.append({ ...f1, id: 'c' });
    expect(l.knownIds().has('a')).toBe(false);
    expect(l.knownIds().has('c')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/stores/fills-ledger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FillsLedger**

Create `src/account/stores/fills-ledger.ts`:

```ts
import type { Fill } from '../types';

export interface FillsLedgerOptions {
  ringSize: number;
}

export class FillsLedger {
  private ring: Fill[] = [];
  private ids = new Set<string>();
  private maxCursor = '';

  constructor(private opts: FillsLedgerOptions) {}

  append(fill: Fill): boolean {
    if (this.ids.has(fill.id)) return false;
    this.ring.push(fill);
    this.ids.add(fill.id);
    if (fill.executedAt > this.maxCursor) this.maxCursor = fill.executedAt;
    while (this.ring.length > this.opts.ringSize) {
      const evicted = this.ring.shift()!;
      this.ids.delete(evicted.id);
    }
    return true;
  }

  recent(n: number): Fill[] {
    return this.ring
      .slice()
      .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
      .slice(-n);
  }

  knownIds(): Set<string> {
    return this.ids;
  }

  cursor(): string {
    return this.maxCursor;
  }

  setCursor(ts: string): void {
    if (ts > this.maxCursor) this.maxCursor = ts;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/stores/fills-ledger.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/stores/fills-ledger.ts tests/account/stores/fills-ledger.test.ts
git commit -m "feat(f3): FillsLedger ring buffer with idempotent append and cursor"
```

---

## Task 8: DivergenceDetector

**Files:**
- Create: `src/account/divergence-detector.ts`
- Create: `tests/account/divergence-detector.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/divergence-detector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DivergenceDetector } from '../../../src/account/divergence-detector';
import type { Position } from '../../../src/account/types';

const p1: Position = {
  id: 'p1', pair: 'B-BTC_USDT', side: 'long',
  activePos: '0.5', avgPrice: '50000', markPrice: '50100',
  marginCurrency: 'USDT', unrealizedPnl: '50', realizedPnl: '0',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

const cfg = { pnlAbsAlarm: 100, pnlPctAlarm: 0.01 };

describe('DivergenceDetector', () => {
  it('returns empty when local matches REST', () => {
    const d = new DivergenceDetector(cfg);
    expect(d.diffPositions([p1], [{ ...p1, source: 'rest' }])).toEqual([]);
  });

  it('flags missing_in_local when REST has id local lacks', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([], [{ ...p1, source: 'rest' }]);
    expect(out).toEqual([{ kind: 'missing_in_local', id: 'p1', restRow: expect.objectContaining({ id: 'p1' }), severity: 'warn' }]);
  });

  it('flags missing_in_rest when local has id REST lacks', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], []);
    expect(out).toEqual([{ kind: 'missing_in_rest', id: 'p1', localRow: expect.objectContaining({ id: 'p1' }), severity: 'warn' }]);
  });

  it('alarms on activePos mismatch always', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], [{ ...p1, activePos: '0.4', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({
      kind: 'field_mismatch', field: 'activePos', severity: 'alarm',
    }));
  });

  it('alarms on pnl diff above absolute floor', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], [{ ...p1, unrealizedPnl: '500', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({
      kind: 'field_mismatch', field: 'unrealizedPnl', severity: 'alarm',
    }));
  });

  it('warns on pnl diff below absolute and percentage floor', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([{ ...p1, unrealizedPnl: '5000' }], [{ ...p1, unrealizedPnl: '5005', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({
      kind: 'field_mismatch', field: 'unrealizedPnl', severity: 'warn',
    }));
  });

  it('info severity on benign field (markPrice)', () => {
    const d = new DivergenceDetector(cfg);
    const out = d.diffPositions([p1], [{ ...p1, markPrice: '50200', source: 'rest' }]);
    expect(out).toContainEqual(expect.objectContaining({ field: 'markPrice', severity: 'info' }));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/divergence-detector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement DivergenceDetector**

Create `src/account/divergence-detector.ts`:

```ts
import type { Balance, Order, Position } from './types';

export type Severity = 'info' | 'warn' | 'alarm';

export type Diff =
  | { kind: 'missing_in_local'; id: string; restRow: any; severity: Severity }
  | { kind: 'missing_in_rest'; id: string; localRow: any; severity: Severity }
  | { kind: 'field_mismatch'; id: string; field: string; local: string; rest: string; severity: Severity };

export interface DivergenceConfig {
  pnlAbsAlarm: number;
  pnlPctAlarm: number;
}

const QTY_FIELDS_POSITION = ['activePos'] as const;
const PNL_FIELDS_POSITION = ['unrealizedPnl', 'realizedPnl'] as const;
const COMPARE_POSITION = ['activePos', 'avgPrice', 'markPrice', 'unrealizedPnl', 'realizedPnl', 'leverage'] as const;

const QTY_FIELDS_BALANCE = ['available', 'locked'] as const;
const COMPARE_BALANCE = ['available', 'locked'] as const;

const QTY_FIELDS_ORDER = ['totalQty', 'remainingQty'] as const;
const COMPARE_ORDER = ['status', 'totalQty', 'remainingQty', 'avgFillPrice', 'price'] as const;

export class DivergenceDetector {
  constructor(private cfg: DivergenceConfig) {}

  diffPositions(local: Position[], rest: Position[]): Diff[] {
    return this.diffEntities(local, rest, COMPARE_POSITION as readonly string[], QTY_FIELDS_POSITION as readonly string[], PNL_FIELDS_POSITION as readonly string[]);
  }

  diffBalances(local: Balance[], rest: Balance[]): Diff[] {
    const idLocal = new Map(local.map(b => [b.currency, b]));
    const idRest = new Map(rest.map(b => [b.currency, b]));
    return this.diffMaps(idLocal, idRest, COMPARE_BALANCE as readonly string[], QTY_FIELDS_BALANCE as readonly string[], []);
  }

  diffOrders(local: Order[], rest: Order[]): Diff[] {
    return this.diffEntities(local, rest, COMPARE_ORDER as readonly string[], QTY_FIELDS_ORDER as readonly string[], []);
  }

  private diffEntities<T extends { id: string }>(
    local: T[], rest: T[],
    compareFields: readonly string[], qtyFields: readonly string[], pnlFields: readonly string[],
  ): Diff[] {
    const idLocal = new Map(local.map(x => [x.id, x]));
    const idRest = new Map(rest.map(x => [x.id, x]));
    return this.diffMaps(idLocal, idRest, compareFields, qtyFields, pnlFields);
  }

  private diffMaps<T>(
    idLocal: Map<string, T>, idRest: Map<string, T>,
    compareFields: readonly string[], qtyFields: readonly string[], pnlFields: readonly string[],
  ): Diff[] {
    const diffs: Diff[] = [];
    for (const [id, restRow] of idRest) {
      const localRow = idLocal.get(id);
      if (!localRow) {
        diffs.push({ kind: 'missing_in_local', id, restRow, severity: 'warn' });
        continue;
      }
      for (const field of compareFields) {
        const lv = String((localRow as any)[field] ?? '');
        const rv = String((restRow as any)[field] ?? '');
        if (lv === rv) continue;
        diffs.push({
          kind: 'field_mismatch', id, field, local: lv, rest: rv,
          severity: this.classify(field, lv, rv, qtyFields, pnlFields),
        });
      }
    }
    for (const [id, localRow] of idLocal) {
      if (!idRest.has(id)) {
        diffs.push({ kind: 'missing_in_rest', id, localRow, severity: 'warn' });
      }
    }
    return diffs;
  }

  private classify(field: string, local: string, rest: string, qty: readonly string[], pnl: readonly string[]): Severity {
    if (qty.includes(field)) return 'alarm';
    if (pnl.includes(field)) {
      const lv = Number(local);
      const rv = Number(rest);
      const diff = Math.abs(lv - rv);
      if (diff > this.cfg.pnlAbsAlarm) return 'alarm';
      const denom = Math.max(Math.abs(lv), Math.abs(rv), 1);
      if (diff / denom > this.cfg.pnlPctAlarm) return 'alarm';
      return 'warn';
    }
    return 'info';
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/divergence-detector.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/divergence-detector.ts tests/account/divergence-detector.test.ts
git commit -m "feat(f3): DivergenceDetector with severity classification"
```

---

## Task 9: HeartbeatWatcher

**Files:**
- Create: `src/account/heartbeat-watcher.ts`
- Create: `tests/account/heartbeat-watcher.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/heartbeat-watcher.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { HeartbeatWatcher } from '../../../src/account/heartbeat-watcher';

describe('HeartbeatWatcher', () => {
  it('emits stale when channel quiet past floor', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 100, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    now += 50;
    w.tick();
    expect(onStale).not.toHaveBeenCalled();
    now += 100;
    w.tick();
    expect(onStale).toHaveBeenCalledWith('position');
  });

  it('touch resets staleness', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 100, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    now += 200;
    w.touch('position');
    w.tick();
    expect(onStale).not.toHaveBeenCalled();
  });

  it('does not emit twice for same stale window', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 100, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    now += 200;
    w.tick();
    w.tick();
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('channels are independent', () => {
    let now = 1000;
    const clock = () => now;
    const onStale = vi.fn();
    const w = new HeartbeatWatcher({
      floors: { position: 100, balance: 1000, order: 100, fill: 100 },
      clock, onStale,
    });
    w.touch('position');
    w.touch('balance');
    now += 200;
    w.tick();
    expect(onStale).toHaveBeenCalledWith('position');
    expect(onStale).not.toHaveBeenCalledWith('balance');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/heartbeat-watcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement HeartbeatWatcher**

Create `src/account/heartbeat-watcher.ts`:

```ts
import type { Entity } from './types';

export interface HeartbeatFloors {
  position: number;
  balance: number;
  order: number;
  fill: number;
}

export interface HeartbeatOptions {
  floors: HeartbeatFloors;
  clock?: () => number;
  onStale: (channel: Entity) => void;
}

export class HeartbeatWatcher {
  private last: Record<Entity, number>;
  private staleNotified: Record<Entity, boolean>;
  private clock: () => number;

  constructor(private opts: HeartbeatOptions) {
    this.clock = opts.clock ?? Date.now;
    const now = this.clock();
    this.last = { position: now, balance: now, order: now, fill: now };
    this.staleNotified = { position: false, balance: false, order: false, fill: false };
  }

  touch(channel: Entity): void {
    this.last[channel] = this.clock();
    this.staleNotified[channel] = false;
  }

  tick(): void {
    const now = this.clock();
    const channels: Entity[] = ['position', 'balance', 'order', 'fill'];
    for (const ch of channels) {
      const age = now - this.last[ch];
      if (age >= this.opts.floors[ch] && !this.staleNotified[ch]) {
        this.staleNotified[ch] = true;
        this.opts.onStale(ch);
      }
    }
  }

  lastSeen(channel: Entity): number {
    return this.last[channel];
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/heartbeat-watcher.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/heartbeat-watcher.ts tests/account/heartbeat-watcher.test.ts
git commit -m "feat(f3): HeartbeatWatcher per-channel staleness"
```

---

## Task 10: DriftSweeper

**Files:**
- Create: `src/account/drift-sweeper.ts`
- Create: `tests/account/drift-sweeper.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/drift-sweeper.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DriftSweeper } from '../../../src/account/drift-sweeper';

describe('DriftSweeper', () => {
  it('schedules sweeps on the configured interval', async () => {
    vi.useFakeTimers();
    const onSweep = vi.fn().mockResolvedValue(undefined);
    const tryAcquire = vi.fn().mockResolvedValue(true);
    const s = new DriftSweeper({ intervalMs: 1000, onSweep, tryAcquire });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSweep).toHaveBeenCalledTimes(2);
    s.stop();
    vi.useRealTimers();
  });

  it('skips sweep when bucket cannot be acquired', async () => {
    vi.useFakeTimers();
    const onSweep = vi.fn().mockResolvedValue(undefined);
    const tryAcquire = vi.fn().mockResolvedValue(false);
    const s = new DriftSweeper({ intervalMs: 1000, onSweep, tryAcquire });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSweep).not.toHaveBeenCalled();
    s.stop();
    vi.useRealTimers();
  });

  it('stop prevents further sweeps', async () => {
    vi.useFakeTimers();
    const onSweep = vi.fn().mockResolvedValue(undefined);
    const tryAcquire = vi.fn().mockResolvedValue(true);
    const s = new DriftSweeper({ intervalMs: 1000, onSweep, tryAcquire });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    s.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSweep).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/drift-sweeper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement DriftSweeper**

Create `src/account/drift-sweeper.ts`:

```ts
export interface DriftSweeperOptions {
  intervalMs: number;
  onSweep: () => Promise<void>;
  tryAcquire: () => Promise<boolean>;
}

export class DriftSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: DriftSweeperOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      const ok = await this.opts.tryAcquire();
      if (!ok) return;
      await this.opts.onSweep();
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/drift-sweeper.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/drift-sweeper.ts tests/account/drift-sweeper.test.ts
git commit -m "feat(f3): DriftSweeper interval loop with rate-limit acquire"
```

---

## Task 11: Add gateway methods getOpenOrders + getFuturesTradeHistory

**Files:**
- Modify: `src/gateways/coindcx-api.ts`

- [ ] **Step 1: Add a quick smoke test for the request shape**

Create `tests/gateways/coindcx-api-shapes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { CoinDCXApi, __httpForTests } from '../../src/gateways/coindcx-api';

describe('CoinDCXApi new endpoints', () => {
  it('getOpenOrders posts to /futures/orders with status=open', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getOpenOrders();
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/orders',
      expect.objectContaining({ status: 'open' }),
      expect.any(Object),
    );
    spy.mockRestore();
  });

  it('getFuturesTradeHistory posts to /futures/trade_history with from_timestamp', async () => {
    const spy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getFuturesTradeHistory({ fromTimestamp: 12345 });
    expect(spy).toHaveBeenCalledWith(
      '/exchange/v1/derivatives/futures/trade_history',
      expect.objectContaining({ from_timestamp: 12345 }),
      expect.any(Object),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/gateways/coindcx-api-shapes.test.ts`
Expected: FAIL — `CoinDCXApi.getOpenOrders is not a function`.

- [ ] **Step 3: Add the methods**

In `src/gateways/coindcx-api.ts`, after `getFuturesPositions`, add:

```ts
  static async getOpenOrders() {
    const { body, headers } = this.buildSignedRequest({
      timestamp: Date.now(),
      status: 'open',
      page: '1',
      size: '100',
      margin_currency_short_name: ['USDT', 'INR'],
    });
    try {
      const response = await http.post(
        '/exchange/v1/derivatives/futures/orders',
        body,
        { headers },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`OpenOrders API [${status || 'timeout'}]: ${msg}`);
    }
  }

  static async getFuturesTradeHistory(opts: { fromTimestamp?: number; size?: number } = {}) {
    const { body, headers } = this.buildSignedRequest({
      timestamp: Date.now(),
      from_timestamp: opts.fromTimestamp ?? 0,
      size: String(opts.size ?? 100),
      margin_currency_short_name: ['USDT', 'INR'],
    });
    try {
      const response = await http.post(
        '/exchange/v1/derivatives/futures/trade_history',
        body,
        { headers },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`TradeHistory API [${status || 'timeout'}]: ${msg}`);
    }
  }
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/gateways/coindcx-api-shapes.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/gateways/coindcx-api.ts tests/gateways/coindcx-api-shapes.test.ts
git commit -m "feat(f3): add getOpenOrders and getFuturesTradeHistory gateway methods"
```

---

## Task 12: Persistence module

**Files:**
- Create: `src/account/persistence.ts`
- Create: `tests/account/persistence.test.ts` (in-memory pool stub)

- [ ] **Step 1: Write failing test**

Create `tests/account/persistence.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AccountPersistence } from '../../src/account/persistence';
import type { Position } from '../../src/account/types';

const p1: Position = {
  id: 'p1', pair: 'B-BTC_USDT', side: 'long',
  activePos: '0.5', avgPrice: '50000', markPrice: '50100',
  marginCurrency: 'USDT', unrealizedPnl: '50', realizedPnl: '0',
  updatedAt: '2026-04-26T00:00:00Z', source: 'ws',
};

function fakePool() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return {
    pool: { query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows: [] }; }) },
    calls,
  };
}

describe('AccountPersistence', () => {
  it('upsertPosition issues INSERT ... ON CONFLICT DO UPDATE', async () => {
    const f = fakePool();
    const p = new AccountPersistence({ pool: f.pool as any, retryMax: 100 });
    await p.upsertPosition(p1);
    expect(f.calls[0]!.sql).toMatch(/INSERT INTO positions/);
    expect(f.calls[0]!.sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(f.calls[0]!.params[0]).toBe('p1');
  });

  it('appendFill is idempotent via ON CONFLICT DO NOTHING', async () => {
    const f = fakePool();
    const p = new AccountPersistence({ pool: f.pool as any, retryMax: 100 });
    await p.appendFill({
      id: 'f1', pair: 'X', side: 'buy', price: '1', qty: '1',
      executedAt: '2026-04-26T00:00:00Z', ingestedAt: '2026-04-26T00:00:01Z', source: 'ws',
    });
    expect(f.calls[0]!.sql).toMatch(/INSERT INTO fills_ledger/);
    expect(f.calls[0]!.sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it('recordChangelog inserts into account_changelog', async () => {
    const f = fakePool();
    const p = new AccountPersistence({ pool: f.pool as any, retryMax: 100 });
    await p.recordChangelog({
      entity: 'position', entityId: 'p1', field: 'markPrice',
      oldValue: '50100', newValue: '51000', cause: 'ws_apply', severity: null,
    });
    expect(f.calls[0]!.sql).toMatch(/INSERT INTO account_changelog/);
    expect(f.calls[0]!.params).toEqual(expect.arrayContaining(['position', 'p1', 'markPrice', '50100', '51000', 'ws_apply', null]));
  });

  it('queues writes when pool throws and flushes on success', async () => {
    let fail = true;
    const calls: Array<{ sql: string; params: any[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (fail) throw new Error('pg down');
        calls.push({ sql, params });
        return { rows: [] };
      }),
    };
    const p = new AccountPersistence({ pool: pool as any, retryMax: 100 });
    await p.upsertPosition(p1);
    expect(p.queueSize()).toBe(1);
    fail = false;
    await p.flush();
    expect(p.queueSize()).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('drops oldest when retry buffer overflows', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('pg down'); }) };
    const p = new AccountPersistence({ pool: pool as any, retryMax: 2 });
    await p.upsertPosition({ ...p1, id: 'a' });
    await p.upsertPosition({ ...p1, id: 'b' });
    await p.upsertPosition({ ...p1, id: 'c' });
    expect(p.queueSize()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/persistence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement persistence**

Create `src/account/persistence.ts`:

```ts
import type { Pool } from 'pg';
import type { Balance, Fill, Order, Position, Source } from './types';

interface QueuedWrite { sql: string; params: any[] }

export interface ChangelogRow {
  entity: 'position' | 'balance' | 'order' | 'fill';
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  cause: 'ws_apply' | 'rest_sweep' | 'divergence';
  severity: 'info' | 'warn' | 'alarm' | null;
}

export interface PersistenceOptions {
  pool: Pool;
  retryMax: number;
}

const POSITION_SQL = `INSERT INTO positions
  (id, pair, side, active_pos, avg_price, mark_price, liquidation_price, leverage, margin_currency, unrealized_pnl, realized_pnl, opened_at, updated_at, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (id) DO UPDATE SET
    pair=EXCLUDED.pair, side=EXCLUDED.side, active_pos=EXCLUDED.active_pos, avg_price=EXCLUDED.avg_price,
    mark_price=EXCLUDED.mark_price, liquidation_price=EXCLUDED.liquidation_price, leverage=EXCLUDED.leverage,
    margin_currency=EXCLUDED.margin_currency, unrealized_pnl=EXCLUDED.unrealized_pnl,
    realized_pnl=EXCLUDED.realized_pnl, opened_at=EXCLUDED.opened_at, updated_at=EXCLUDED.updated_at, source=EXCLUDED.source`;

const BALANCE_SQL = `INSERT INTO balances (currency, available, locked, updated_at, source)
  VALUES ($1,$2,$3,$4,$5)
  ON CONFLICT (currency) DO UPDATE SET
    available=EXCLUDED.available, locked=EXCLUDED.locked,
    updated_at=EXCLUDED.updated_at, source=EXCLUDED.source`;

const ORDER_SQL = `INSERT INTO orders
  (id, pair, side, type, status, price, total_quantity, remaining_qty, avg_fill_price, position_id, created_at, updated_at, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (id) DO UPDATE SET
    pair=EXCLUDED.pair, side=EXCLUDED.side, type=EXCLUDED.type, status=EXCLUDED.status,
    price=EXCLUDED.price, total_quantity=EXCLUDED.total_quantity, remaining_qty=EXCLUDED.remaining_qty,
    avg_fill_price=EXCLUDED.avg_fill_price, position_id=EXCLUDED.position_id,
    updated_at=EXCLUDED.updated_at, source=EXCLUDED.source`;

const FILL_SQL = `INSERT INTO fills_ledger
  (id, order_id, position_id, pair, side, price, qty, fee, fee_currency, realized_pnl, executed_at, ingested_at, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (id) DO NOTHING`;

const CHANGELOG_SQL = `INSERT INTO account_changelog
  (entity, entity_id, field, old_value, new_value, cause, severity, recorded_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;

export class AccountPersistence {
  private queue: QueuedWrite[] = [];

  constructor(private opts: PersistenceOptions) {}

  async upsertPosition(p: Position): Promise<void> {
    return this.write(POSITION_SQL, [
      p.id, p.pair, p.side, p.activePos, p.avgPrice, p.markPrice ?? null,
      p.liquidationPrice ?? null, p.leverage ?? null, p.marginCurrency,
      p.unrealizedPnl, p.realizedPnl, p.openedAt ?? null, p.updatedAt, p.source,
    ]);
  }

  async upsertBalance(b: Balance): Promise<void> {
    return this.write(BALANCE_SQL, [b.currency, b.available, b.locked, b.updatedAt, b.source]);
  }

  async upsertOrder(o: Order): Promise<void> {
    return this.write(ORDER_SQL, [
      o.id, o.pair, o.side, o.type, o.status, o.price ?? null,
      o.totalQty, o.remainingQty, o.avgFillPrice ?? null, o.positionId ?? null,
      o.createdAt, o.updatedAt, o.source,
    ]);
  }

  async appendFill(f: Fill): Promise<void> {
    return this.write(FILL_SQL, [
      f.id, f.orderId ?? null, f.positionId ?? null, f.pair, f.side,
      f.price, f.qty, f.fee ?? null, f.feeCurrency ?? null, f.realizedPnl ?? null,
      f.executedAt, f.ingestedAt, f.source,
    ]);
  }

  async recordChangelog(row: ChangelogRow): Promise<void> {
    return this.write(CHANGELOG_SQL, [
      row.entity, row.entityId, row.field, row.oldValue, row.newValue, row.cause, row.severity, new Date().toISOString(),
    ]);
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const w = this.queue[0]!;
      try {
        await this.opts.pool.query(w.sql, w.params);
        this.queue.shift();
      } catch {
        return;
      }
    }
  }

  queueSize(): number {
    return this.queue.length;
  }

  private async write(sql: string, params: any[]): Promise<void> {
    try {
      await this.opts.pool.query(sql, params);
    } catch {
      this.queue.push({ sql, params });
      while (this.queue.length > this.opts.retryMax) this.queue.shift();
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/persistence.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/persistence.ts tests/account/persistence.test.ts
git commit -m "feat(f3): AccountPersistence with retry buffer"
```

---

## Task 13: WS payload normalizers (zod)

**Files:**
- Create: `src/account/normalizers.ts`
- Create: `tests/account/normalizers.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/account/normalizers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizePosition, normalizeBalance, normalizeOrder, normalizeFill } from '../../src/account/normalizers';

describe('normalizers', () => {
  it('normalizePosition handles WS shape', () => {
    const raw = {
      id: 'p1', pair: 'B-BTC_USDT', active_pos: 0.5, avg_price: 50000, mark_price: 50100,
      leverage: 5, margin_currency_short_name: 'USDT', unrealized_pnl: 50, updated_at: 'now',
    };
    const p = normalizePosition(raw, 'ws', 'now');
    expect(p.id).toBe('p1');
    expect(p.activePos).toBe('0.5');
    expect(p.side).toBe('long');
    expect(p.marginCurrency).toBe('USDT');
    expect(p.source).toBe('ws');
  });

  it('normalizePosition flat side when active_pos == 0', () => {
    const raw = { id: 'p1', pair: 'X', active_pos: 0, avg_price: 0, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' };
    expect(normalizePosition(raw, 'rest', 'now').side).toBe('flat');
  });

  it('normalizePosition short side when active_pos negative', () => {
    const raw = { id: 'p1', pair: 'X', active_pos: -1, avg_price: 50, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' };
    expect(normalizePosition(raw, 'rest', 'now').side).toBe('short');
  });

  it('normalizeBalance maps currency_short_name + locked_balance', () => {
    const raw = { currency_short_name: 'USDT', balance: 100, locked_balance: 50 };
    const b = normalizeBalance(raw, 'ws', 'now');
    expect(b.currency).toBe('USDT');
    expect(b.available).toBe('100');
    expect(b.locked).toBe('50');
  });

  it('normalizeOrder maps total_quantity + remaining_quantity', () => {
    const raw = { id: 'o1', pair: 'X', side: 'buy', order_type: 'limit', status: 'open',
      price: 1, total_quantity: 1, remaining_quantity: 1, created_at: 't', updated_at: 't' };
    const o = normalizeOrder(raw, 'ws');
    expect(o.totalQty).toBe('1');
    expect(o.remainingQty).toBe('1');
    expect(o.type).toBe('limit');
  });

  it('normalizeFill maps trade payload + ingestedAt clock', () => {
    const raw = { id: 'f1', order_id: 'o1', pair: 'X', side: 'buy', price: 1, quantity: 1,
      fee: 0.01, fee_currency: 'USDT', realized_pnl: 5, executed_at: 't' };
    const f = normalizeFill(raw, 'ws', 'now');
    expect(f.orderId).toBe('o1');
    expect(f.qty).toBe('1');
    expect(f.realizedPnl).toBe('5');
    expect(f.ingestedAt).toBe('now');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/normalizers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement normalizers**

Create `src/account/normalizers.ts`:

```ts
import type { Balance, Fill, Order, OrderSide, OrderStatus, Position, Side, Source } from './types';

const str = (v: any): string => (v === undefined || v === null ? '' : String(v));

function classifySide(activePos: number): Side {
  if (activePos > 0) return 'long';
  if (activePos < 0) return 'short';
  return 'flat';
}

export function normalizePosition(raw: any, source: Source, now: string): Position {
  const activePos = Number(raw.active_pos ?? 0);
  return {
    id: str(raw.id),
    pair: str(raw.pair),
    side: classifySide(activePos),
    activePos: str(raw.active_pos ?? 0),
    avgPrice: str(raw.avg_price ?? 0),
    markPrice: raw.mark_price !== undefined ? str(raw.mark_price) : undefined,
    liquidationPrice: raw.liquidation_price !== undefined ? str(raw.liquidation_price) : undefined,
    leverage: raw.leverage !== undefined ? str(raw.leverage) : undefined,
    marginCurrency: str(raw.margin_currency_short_name ?? raw.settlement_currency_short_name ?? 'USDT').toUpperCase(),
    unrealizedPnl: str(raw.unrealized_pnl ?? 0),
    realizedPnl: str(raw.realized_pnl ?? 0),
    openedAt: raw.opened_at ? str(raw.opened_at) : undefined,
    updatedAt: str(raw.updated_at ?? now),
    source,
  };
}

export function normalizeBalance(raw: any, source: Source, now: string): Balance {
  return {
    currency: str(raw.currency_short_name ?? raw.currency).toUpperCase(),
    available: str(raw.balance ?? 0),
    locked: str(raw.locked_balance ?? raw.locked ?? 0),
    updatedAt: str(raw.updated_at ?? now),
    source,
  };
}

export function normalizeOrder(raw: any, source: Source): Order {
  const side = (str(raw.side).toLowerCase() === 'sell' ? 'sell' : 'buy') as OrderSide;
  return {
    id: str(raw.id),
    pair: str(raw.pair),
    side,
    type: str(raw.order_type ?? raw.type ?? 'unknown'),
    status: (str(raw.status).toLowerCase() || 'open') as OrderStatus,
    price: raw.price !== undefined ? str(raw.price) : undefined,
    totalQty: str(raw.total_quantity ?? raw.quantity ?? 0),
    remainingQty: str(raw.remaining_quantity ?? 0),
    avgFillPrice: raw.avg_price !== undefined ? str(raw.avg_price) : undefined,
    positionId: raw.position_id !== undefined ? str(raw.position_id) : undefined,
    createdAt: str(raw.created_at ?? raw.updated_at ?? ''),
    updatedAt: str(raw.updated_at ?? raw.created_at ?? ''),
    source,
  };
}

export function normalizeFill(raw: any, source: Source, now: string): Fill {
  const side = (str(raw.side).toLowerCase() === 'sell' ? 'sell' : 'buy') as OrderSide;
  return {
    id: str(raw.id),
    orderId: raw.order_id !== undefined ? str(raw.order_id) : undefined,
    positionId: raw.position_id !== undefined ? str(raw.position_id) : undefined,
    pair: str(raw.pair),
    side,
    price: str(raw.price ?? 0),
    qty: str(raw.quantity ?? raw.qty ?? 0),
    fee: raw.fee !== undefined ? str(raw.fee) : undefined,
    feeCurrency: raw.fee_currency !== undefined ? str(raw.fee_currency) : undefined,
    realizedPnl: raw.realized_pnl !== undefined ? str(raw.realized_pnl) : undefined,
    executedAt: str(raw.executed_at ?? raw.timestamp ?? now),
    ingestedAt: now,
    source,
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/normalizers.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/normalizers.ts tests/account/normalizers.test.ts
git commit -m "feat(f3): account WS/REST payload normalizers"
```

---

## Task 14: ReconcileController scaffold + WS ingest

**Files:**
- Create: `src/account/reconcile-controller.ts`
- Create: `tests/account/reconcile-controller.test.ts`

- [ ] **Step 1: Write failing test for WS ingest**

Create `tests/account/reconcile-controller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AccountReconcileController } from '../../src/account/reconcile-controller';

const mockSignalBus = () => {
  const emit = vi.fn().mockResolvedValue(undefined);
  return { bus: { emit } as any, emit };
};

const mockPersistence = () => ({
  upsertPosition: vi.fn().mockResolvedValue(undefined),
  upsertBalance: vi.fn().mockResolvedValue(undefined),
  upsertOrder: vi.fn().mockResolvedValue(undefined),
  appendFill: vi.fn().mockResolvedValue(undefined),
  recordChangelog: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  queueSize: () => 0,
});

const mockRest = () => ({
  getFuturesPositions: vi.fn().mockResolvedValue({ data: [] }),
  getBalances: vi.fn().mockResolvedValue([]),
  getOpenOrders: vi.fn().mockResolvedValue({ data: [] }),
  getFuturesTradeHistory: vi.fn().mockResolvedValue({ data: [] }),
});

const baseConfig = {
  driftSweepMs: 1_000_000,
  heartbeatFloors: { position: 100_000, balance: 100_000, order: 100_000, fill: 100_000 },
  pnlAlarmPct: -0.10,
  utilAlarmPct: 0.90,
  divergencePnlAbsAlarm: 100,
  divergencePnlPctAlarm: 0.01,
  backfillHours: 24,
  signalCooldownMs: 100_000,
  stormThreshold: 20,
  stormWindowMs: 60_000,
};

describe('AccountReconcileController WS ingest', () => {
  it('upserts position and emits position.opened lifecycle', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' });
    expect(persist.upsertPosition).toHaveBeenCalled();
    expect(sig.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'position.opened' }));
  });

  it('emits fill.executed and appends to ledger', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.ingest('fill', { id: 'f1', pair: 'X', side: 'buy', price: 1, quantity: 1, executed_at: 't' });
    expect(persist.appendFill).toHaveBeenCalled();
    expect(sig.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'fill.executed' }));
  });

  it('snapshot returns AccountSnapshot shape', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    const s = c.snapshot();
    expect(s).toEqual(expect.objectContaining({
      positions: [], balances: [], orders: [],
      totals: expect.objectContaining({ equityInr: expect.any(String) }),
    }));
  });

  it('cooldown suppresses duplicate threshold signals', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 100,
      margin_currency_short_name: 'USDT', unrealized_pnl: -50, updated_at: 'now' });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 100,
      margin_currency_short_name: 'USDT', unrealized_pnl: -55, updated_at: 'now' });
    const calls = sig.emit.mock.calls.filter(c => (c[0] as any).type === 'position.pnl_threshold');
    expect(calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/account/reconcile-controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement controller**

Create `src/account/reconcile-controller.ts`:

```ts
import type { SignalBus } from '../signals/bus';
import type { Signal, Severity } from '../signals/types';
import { PositionStore } from './stores/position-store';
import { BalanceStore } from './stores/balance-store';
import { OrderStore } from './stores/order-store';
import { FillsLedger } from './stores/fills-ledger';
import { DivergenceDetector, type Diff } from './divergence-detector';
import { HeartbeatWatcher } from './heartbeat-watcher';
import { DriftSweeper } from './drift-sweeper';
import type { AccountPersistence } from './persistence';
import { normalizePosition, normalizeBalance, normalizeOrder, normalizeFill } from './normalizers';
import type { AccountSnapshot, Entity, Position, Source } from './types';

export interface ReconcileConfig {
  driftSweepMs: number;
  heartbeatFloors: { position: number; balance: number; order: number; fill: number };
  pnlAlarmPct: number;
  utilAlarmPct: number;
  divergencePnlAbsAlarm: number;
  divergencePnlPctAlarm: number;
  backfillHours: number;
  signalCooldownMs: number;
  stormThreshold: number;
  stormWindowMs: number;
}

export interface RestApiLike {
  getFuturesPositions: () => Promise<any>;
  getBalances: () => Promise<any>;
  getOpenOrders: () => Promise<any>;
  getFuturesTradeHistory: (opts: { fromTimestamp?: number; size?: number }) => Promise<any>;
}

export interface ReconcileControllerOptions {
  restApi: RestApiLike;
  persistence: AccountPersistence;
  signalBus: SignalBus;
  tryAcquireBudget: () => Promise<boolean>;
  config: ReconcileConfig;
  clock?: () => number;
}

const STRATEGY = 'account.reconciler';

export class AccountReconcileController {
  readonly positions = new PositionStore();
  readonly balances = new BalanceStore();
  readonly orders: OrderStore;
  readonly fills = new FillsLedger({ ringSize: 1000 });
  private detector: DivergenceDetector;
  private heartbeat: HeartbeatWatcher;
  private sweeper: DriftSweeper;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cooldownAt = new Map<string, number>();
  private stormTimes: number[] = [];
  private clock: () => number;

  constructor(private opts: ReconcileControllerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.orders = new OrderStore({ closedTtlMs: 86_400_000, closedMax: 500, clock: this.clock });
    this.detector = new DivergenceDetector({
      pnlAbsAlarm: opts.config.divergencePnlAbsAlarm,
      pnlPctAlarm: opts.config.divergencePnlPctAlarm,
    });
    this.heartbeat = new HeartbeatWatcher({
      floors: opts.config.heartbeatFloors,
      clock: this.clock,
      onStale: ch => { void this.forcedSweep(ch); },
    });
    this.sweeper = new DriftSweeper({
      intervalMs: opts.config.driftSweepMs,
      onSweep: () => this.driftSweep(),
      tryAcquire: opts.tryAcquireBudget,
    });
  }

  start(): void {
    this.sweeper.start();
    this.heartbeatTimer = setInterval(() => this.heartbeat.tick(), 5000);
  }

  stop(): void {
    this.sweeper.stop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async ingest(entity: Entity, raw: any, source: Source = 'ws'): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    this.heartbeat.touch(entity);
    if (entity === 'position') {
      const p = normalizePosition(raw, source, now);
      const r = this.positions.applyWs(p);
      await this.opts.persistence.upsertPosition(p);
      await this.recordDiff('position', p.id, r.prev, p, r.changedFields, 'ws_apply', null);
      if (r.lifecycle) await this.emitLifecycle(p, r.lifecycle);
      await this.maybeEmitThreshold(p);
      return;
    }
    if (entity === 'balance') {
      const b = normalizeBalance(raw, source, now);
      const r = this.balances.applyWs(b);
      await this.opts.persistence.upsertBalance(b);
      await this.recordDiff('balance', b.currency, r.prev, b, r.changedFields, 'ws_apply', null);
      await this.maybeEmitUtilThreshold();
      return;
    }
    if (entity === 'order') {
      const o = normalizeOrder(raw, source);
      const r = this.orders.applyWs(o);
      await this.opts.persistence.upsertOrder(o);
      await this.recordDiff('order', o.id, r.prev, o, r.changedFields, 'ws_apply', null);
      return;
    }
    if (entity === 'fill') {
      const f = normalizeFill(raw, source, now);
      const linkedPositionId = f.orderId ? this.orders.get(f.orderId)?.positionId : undefined;
      const fLinked = { ...f, positionId: f.positionId ?? linkedPositionId };
      if (this.fills.append(fLinked)) {
        await this.opts.persistence.appendFill(fLinked);
        await this.emit({
          type: 'fill.executed', severity: 'info', pair: fLinked.pair,
          payload: { fill: fLinked },
        });
      }
      return;
    }
  }

  snapshot(): AccountSnapshot {
    return {
      positions: this.positions.snapshot(),
      balances: this.balances.snapshot(),
      orders: this.orders.snapshot(),
      totals: this.computeTotals(),
    };
  }

  async forcedSweep(channel: Entity): Promise<void> {
    if (channel === 'position') await this.sweepPositions();
    else if (channel === 'balance') await this.sweepBalances();
    else if (channel === 'order') await this.sweepOrders();
    else if (channel === 'fill') await this.sweepFills();
  }

  private async driftSweep(): Promise<void> {
    await Promise.all([this.sweepPositions(), this.sweepBalances(), this.sweepOrders(), this.sweepFills()]);
  }

  private async sweepPositions(): Promise<void> {
    try {
      const raw = await this.opts.restApi.getFuturesPositions();
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const now = new Date(this.clock()).toISOString();
      const rest = arr.map((r: any) => normalizePosition(r, 'rest', now));
      const localBefore = this.positions.snapshot();
      const diffs = this.detector.diffPositions(localBefore, rest);
      const result = this.positions.replaceFromRest(rest);
      for (const p of rest) await this.opts.persistence.upsertPosition(p);
      for (const id of result.synthesizedFlat) {
        const flat = this.positions.get(id);
        if (flat) await this.opts.persistence.upsertPosition(flat);
        await this.emit({
          type: 'position.closed', severity: 'warn', pair: flat?.pair,
          payload: { id, synthesized: true },
        });
      }
      await this.handleDiffs('position', diffs);
    } catch (err) {
      await this.emitSweepFailed('position', err as Error);
    }
  }

  private async sweepBalances(): Promise<void> {
    try {
      const raw = await this.opts.restApi.getBalances();
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const now = new Date(this.clock()).toISOString();
      const rest = arr.map((r: any) => normalizeBalance(r, 'rest', now));
      const localBefore = this.balances.snapshot();
      const diffs = this.detector.diffBalances(localBefore, rest);
      this.balances.replaceFromRest(rest);
      for (const b of rest) await this.opts.persistence.upsertBalance(b);
      await this.handleDiffs('balance', diffs);
    } catch (err) {
      await this.emitSweepFailed('balance', err as Error);
    }
  }

  private async sweepOrders(): Promise<void> {
    try {
      const raw = await this.opts.restApi.getOpenOrders();
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const rest = arr.map((r: any) => normalizeOrder(r, 'rest'));
      const localBefore = this.orders.snapshot().filter(o => o.status === 'open' || o.status === 'partially_filled');
      const diffs = this.detector.diffOrders(localBefore, rest);
      this.orders.replaceFromRest(rest);
      for (const o of rest) await this.opts.persistence.upsertOrder(o);
      this.orders.evictExpired();
      await this.handleDiffs('order', diffs);
    } catch (err) {
      await this.emitSweepFailed('order', err as Error);
    }
  }

  private async sweepFills(): Promise<void> {
    try {
      const since = this.fills.cursor()
        ? new Date(this.fills.cursor()).getTime()
        : this.clock() - this.opts.config.backfillHours * 3_600_000;
      const raw = await this.opts.restApi.getFuturesTradeHistory({ fromTimestamp: since, size: 100 });
      const arr = Array.isArray(raw) ? raw : (raw?.data ?? []);
      const now = new Date(this.clock()).toISOString();
      for (const r of arr) {
        const f = normalizeFill(r, 'rest', now);
        if (this.fills.append(f)) {
          await this.opts.persistence.appendFill(f);
        }
      }
    } catch (err) {
      await this.emitSweepFailed('fill', err as Error);
    }
  }

  private async handleDiffs(entity: Entity, diffs: Diff[]): Promise<void> {
    if (diffs.length === 0) {
      await this.opts.persistence.recordChangelog({
        entity, entityId: '*', field: '*', oldValue: null, newValue: null,
        cause: 'rest_sweep', severity: null,
      });
      return;
    }
    let alarmCount = 0;
    for (const d of diffs) {
      let oldV: string | null = null;
      let newV: string | null = null;
      let id = '*';
      let field = '*';
      if (d.kind === 'field_mismatch') { id = d.id; field = d.field; oldV = d.local; newV = d.rest; }
      else if (d.kind === 'missing_in_local') { id = d.id; field = '*'; newV = JSON.stringify(d.restRow); }
      else { id = d.id; field = '*'; oldV = JSON.stringify(d.localRow); }
      await this.opts.persistence.recordChangelog({
        entity, entityId: id, field,
        oldValue: oldV, newValue: newV,
        cause: 'divergence', severity: d.severity,
      });
      if (d.severity === 'alarm') alarmCount++;
    }
    if (alarmCount > 0 && !this.suppressedByStorm(alarmCount)) {
      await this.emit({
        type: 'reconcile.divergence', severity: 'critical',
        payload: { entity, diffs },
      });
    }
  }

  private suppressedByStorm(alarmCount: number): boolean {
    const now = this.clock();
    this.stormTimes = this.stormTimes.filter(t => now - t < this.opts.config.stormWindowMs);
    for (let i = 0; i < alarmCount; i++) this.stormTimes.push(now);
    if (this.stormTimes.length > this.opts.config.stormThreshold) {
      void this.emit({
        type: 'reconcile.storm', severity: 'critical',
        payload: { count: this.stormTimes.length, windowMs: this.opts.config.stormWindowMs },
      });
      this.stormTimes = [];
      return true;
    }
    return false;
  }

  private async recordDiff(entity: Entity, entityId: string, prev: any, next: any, fields: string[], cause: 'ws_apply' | 'rest_sweep', severity: Severity | null): Promise<void> {
    if (fields.length === 0) return;
    if (fields.includes('*')) {
      await this.opts.persistence.recordChangelog({ entity, entityId, field: '*', oldValue: null, newValue: JSON.stringify(next), cause, severity });
      return;
    }
    for (const f of fields) {
      await this.opts.persistence.recordChangelog({
        entity, entityId, field: f,
        oldValue: prev ? String((prev as any)[f] ?? '') : null,
        newValue: String((next as any)[f] ?? ''),
        cause, severity,
      });
    }
  }

  private async emitLifecycle(p: Position, lifecycle: 'opened' | 'closed' | 'flipped'): Promise<void> {
    await this.emit({
      type: `position.${lifecycle}`, severity: 'info', pair: p.pair,
      payload: { id: p.id, side: p.side, activePos: p.activePos, realizedPnl: p.realizedPnl },
    });
  }

  private async maybeEmitThreshold(p: Position): Promise<void> {
    const pnl = Number(p.unrealizedPnl);
    const margin = Number(p.avgPrice) * Math.abs(Number(p.activePos));
    if (margin <= 0) return;
    const ratio = pnl / margin;
    if (ratio >= this.opts.config.pnlAlarmPct) return;
    await this.emitThrottled(`position.pnl_threshold:${p.id}`, {
      type: 'position.pnl_threshold', severity: 'warn', pair: p.pair,
      payload: { id: p.id, pnl: p.unrealizedPnl, ratio },
    });
  }

  private async maybeEmitUtilThreshold(): Promise<void> {
    let totalLocked = 0;
    let totalWallet = 0;
    for (const b of this.balances.snapshot()) {
      totalLocked += Number(b.locked);
      totalWallet += Number(b.available) + Number(b.locked);
    }
    if (totalWallet <= 0) return;
    const util = totalLocked / totalWallet;
    if (util < this.opts.config.utilAlarmPct) return;
    await this.emitThrottled(`account.margin_util_high`, {
      type: 'account.margin_util_high', severity: 'warn',
      payload: { util, totalLocked, totalWallet },
    });
  }

  private async emitThrottled(key: string, signal: Omit<Signal, 'id' | 'ts' | 'strategy'>): Promise<void> {
    const now = this.clock();
    const last = this.cooldownAt.get(key) ?? 0;
    if (now - last < this.opts.config.signalCooldownMs) return;
    this.cooldownAt.set(key, now);
    await this.emit(signal);
  }

  private async emit(partial: Omit<Signal, 'id' | 'ts' | 'strategy'>): Promise<void> {
    const signal: Signal = {
      id: `${STRATEGY}:${partial.type}:${this.clock()}`,
      ts: new Date(this.clock()).toISOString(),
      strategy: STRATEGY,
      ...partial,
    };
    await this.opts.signalBus.emit(signal);
  }

  private async emitSweepFailed(entity: Entity, err: Error): Promise<void> {
    await this.emit({
      type: 'reconcile.sweep_failed', severity: 'warn',
      payload: { entity, error: err.message },
    });
  }

  private computeTotals(): AccountSnapshot['totals'] {
    let walletInr = 0;
    let unrealizedInr = 0;
    for (const b of this.balances.snapshot()) {
      const w = Number(b.available) + Number(b.locked);
      if (b.currency === 'INR') walletInr += w;
    }
    for (const p of this.positions.snapshot()) {
      if (p.marginCurrency === 'INR') unrealizedInr += Number(p.unrealizedPnl);
    }
    const equityInr = walletInr + unrealizedInr;
    return {
      equityInr: equityInr.toString(), walletInr: walletInr.toString(),
      unrealizedInr: unrealizedInr.toString(),
      realizedDay: '0', realizedLifetime: '0',
    };
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/account/reconcile-controller.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/account/reconcile-controller.ts tests/account/reconcile-controller.test.ts
git commit -m "feat(f3): AccountReconcileController WS ingest + sweep flows"
```

---

## Task 15: Boot seed + WS reconnect forced sweep

**Files:**
- Modify: `src/account/reconcile-controller.ts` (add `seed()` + `onWsReconnect()`)
- Modify: `tests/account/reconcile-controller.test.ts` (extend)

- [ ] **Step 1: Add failing test**

Append to `tests/account/reconcile-controller.test.ts`:

```ts
describe('AccountReconcileController seed + reconnect', () => {
  it('seed populates stores from REST', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    rest.getFuturesPositions.mockResolvedValue({ data: [{ id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' }] });
    rest.getBalances.mockResolvedValue([{ currency_short_name: 'USDT', balance: 100, locked_balance: 0 }]);
    rest.getOpenOrders.mockResolvedValue({ data: [] });
    rest.getFuturesTradeHistory.mockResolvedValue({ data: [] });
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.seed();
    expect(c.snapshot().positions).toHaveLength(1);
    expect(c.snapshot().balances).toHaveLength(1);
  });

  it('onWsReconnect triggers full sweep', async () => {
    const sig = mockSignalBus();
    const persist = mockPersistence();
    const rest = mockRest();
    const c = new AccountReconcileController({
      restApi: rest as any, persistence: persist as any, signalBus: sig.bus,
      tryAcquireBudget: async () => true, config: baseConfig,
    });
    await c.onWsReconnect();
    expect(rest.getFuturesPositions).toHaveBeenCalled();
    expect(rest.getBalances).toHaveBeenCalled();
    expect(rest.getOpenOrders).toHaveBeenCalled();
    expect(rest.getFuturesTradeHistory).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/account/reconcile-controller.test.ts`
Expected: FAIL — `c.seed is not a function`.

- [ ] **Step 3: Add seed() + onWsReconnect() methods**

In `src/account/reconcile-controller.ts`, inside the class, add after `stop()`:

```ts
  async seed(): Promise<void> {
    await Promise.all([this.sweepPositions(), this.sweepBalances(), this.sweepOrders(), this.sweepFills()]);
  }

  async onWsReconnect(): Promise<void> {
    await this.driftSweep();
  }
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/account/reconcile-controller.test.ts`
Expected: all tests pass (including the 4 prior).

- [ ] **Step 5: Commit**

```bash
git add src/account/reconcile-controller.ts tests/account/reconcile-controller.test.ts
git commit -m "feat(f3): controller seed and WS reconnect forced sweep"
```

---

## Task 16: Wire controller into runApp

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read current shape of index.ts to confirm wiring points**

Run: `sed -n '1,50p' src/index.ts` (manual review).

Identify:
- `signalBus` already constructed (F1)
- `db` pool available
- `ws` is the existing WsManager
- REST API available as `CoinDCXApi` (no instance — static class). Wrap it for the controller's `RestApiLike` interface.

- [ ] **Step 2: Add controller construction**

In `src/index.ts`, near the top of `runApp` after signalBus + ws are created (search for `state.positions = new Map`), insert:

```ts
import { AccountReconcileController } from './account/reconcile-controller';
import { AccountPersistence } from './account/persistence';
```

After ws and signalBus exist:

```ts
const accountPersistence = new AccountPersistence({ pool: db, retryMax: 1000 });
const account = new AccountReconcileController({
  restApi: {
    getFuturesPositions: () => CoinDCXApi.getFuturesPositions(),
    getBalances: () => CoinDCXApi.getBalances(),
    getOpenOrders: () => CoinDCXApi.getOpenOrders(),
    getFuturesTradeHistory: opts => CoinDCXApi.getFuturesTradeHistory(opts),
  },
  persistence: accountPersistence,
  signalBus,
  tryAcquireBudget: () => ctx.restBudget.tryAcquireGlobal(),
  config: {
    driftSweepMs: cfg.ACCOUNT_DRIFT_SWEEP_MS,
    heartbeatFloors: {
      position: cfg.ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS,
      balance: cfg.ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS,
      order: cfg.ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS,
      fill: cfg.ACCOUNT_HEARTBEAT_FLOOR_FILL_MS,
    },
    pnlAlarmPct: cfg.ACCOUNT_PNL_ALARM_PCT,
    utilAlarmPct: cfg.ACCOUNT_UTIL_ALARM_PCT,
    divergencePnlAbsAlarm: cfg.ACCOUNT_DIVERGENCE_PNL_ABS_INR,
    divergencePnlPctAlarm: cfg.ACCOUNT_DIVERGENCE_PNL_PCT,
    backfillHours: cfg.ACCOUNT_BACKFILL_HOURS,
    signalCooldownMs: cfg.ACCOUNT_SIGNAL_COOLDOWN_MS,
    stormThreshold: cfg.ACCOUNT_STORM_THRESHOLD,
    stormWindowMs: cfg.ACCOUNT_STORM_WINDOW_MS,
  },
});
```

If `cfg` is the validated config object: use the exact name from your existing F1 wiring. If `ctx.restBudget` is named differently in F2 (e.g. `ctx.budget`), adjust accordingly — verify with `grep -n 'RestBudget\|restBudget' src/`.

- [ ] **Step 3: Wire WS handlers + lifecycle**

In `src/index.ts`, replace the existing WS subscriptions (`ws.on('df-position-update', ...)`, etc.) with controller routing:

```ts
ws.on('df-position-update', raw => {
  const data = safeParse(raw);
  const arr = Array.isArray(data) ? data : (data ? [data] : []);
  for (const r of arr) void account.ingest('position', r);
});
ws.on('df-order-update', raw => {
  const data = safeParse(raw);
  const arr = Array.isArray(data) ? data : (data ? [data] : []);
  for (const r of arr) void account.ingest('order', r);
});
ws.on('balance-update', raw => {
  const data = safeParse(raw);
  const arr = Array.isArray(data) ? data : (data ? [data] : []);
  for (const r of arr) void account.ingest('balance', r);
});
ws.on('df-trade-update', raw => {
  const data = safeParse(raw);
  const arr = Array.isArray(data) ? data : (data ? [data] : []);
  for (const r of arr) void account.ingest('fill', r);
});
ws.on('connected', () => {
  if (account['running']) void account.onWsReconnect();
  (account as any).running = true;
});
```

Keep the existing `state.positions`/`state.orders`/`state.balanceMap` Maps for now — Task 17 swaps the TUI to read from `account.snapshot()`.

After WS subscriptions, before `ws.connect()`:

```ts
await account.seed();
account.start();
```

In the existing graceful-shutdown handler (search for the F1 lifecycle hook), add:

```ts
account.stop();
await accountPersistence.flush();
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any naming mismatches against current `cfg`/`ctx` shape.

- [ ] **Step 5: Smoke run**

Run: `docker compose up -d && npm run db:migrate && npm start`
Expected: TUI starts without errors. Logs show "Loaded N active positions" via either old fallback path or controller.

Stop with Ctrl+C. Confirm clean shutdown.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat(f3): wire AccountReconcileController into runApp"
```

---

## Task 17: TUI consumes snapshot getter

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace direct state reads with snapshot calls**

In `src/index.ts:223-242` (`refreshPositionsDisplay`), replace:

```ts
function refreshPositionsDisplay() {
  const rows = Array.from(state.positions.values())
    .filter((p: any) => p.active_pos !== 0)
    .map((p: any) => { /* ... */ });
  tui.updatePositions(rows.length > 0 ? rows : [['—', '—', '—', '—', '—', '—', '—', '—']]);
}
```

with:

```ts
function refreshPositionsDisplay() {
  const snap = account.snapshot();
  const rows = snap.positions.map(p => {
    const clean = cleanPair(p.pair || 'N/A');
    const sym = clean.replace('USDT', '');
    const ticker = state.tickers.get(clean);
    return [
      sym,
      p.side === 'long' ? '{green-fg}LONG{/green-fg}' : '{red-fg}SHORT{/red-fg}',
      formatQty(Math.abs(Number(p.activePos))),
      formatPrice(p.avgPrice),
      ticker ? formatPrice(ticker.price) : '—',
      formatPrice(p.markPrice ?? '0'),
      '—',
      formatPnl(Number(p.unrealizedPnl)),
    ];
  });
  tui.updatePositions(rows.length > 0 ? rows : [['—', '—', '—', '—', '—', '—', '—', '—']]);
}
```

In `refreshBalanceDisplay` (line 259), replace `Array.from(state.positions.values())` with `account.snapshot().positions` and `Array.from(state.balanceMap.entries())` with iteration over `account.snapshot().balances`. Keep the existing INR/USDT formatting logic; it now sources from the typed `Balance` rows. Map field names: `info.balance` → `b.available`, `info.locked` → `b.locked`.

In `refreshOrdersDisplay` (line 244), replace `Array.from(state.orders.values())` with `account.snapshot().orders`.

After WS handlers, add a refresh trigger so the TUI updates on each ingest:

```ts
const accountTuiRefresh = () => {
  refreshPositionsDisplay();
  refreshBalanceDisplay();
  refreshOrdersDisplay();
};
setInterval(accountTuiRefresh, 1000);
```

(Keep the existing 30s REST poll in place during the transition; it still serves as a top-up safety net but the controller is the source of truth. Delete it in a follow-up commit once we trust the controller in production.)

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Adjust field references where `state.positions` had legacy snake_case keys.

- [ ] **Step 3: Smoke run**

Run: `npm start`
Expected: positions, balances, orders panels populate. INR row in balances shows aggregated PnL as before.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(f3): TUI reads from AccountReconcileController.snapshot"
```

---

## Task 18: Probe script for raw account-channel capture

**Files:**
- Create: `src/cli/probe-account.ts`
- Modify: `package.json` — add script

- [ ] **Step 1: Add probe script entry**

In `package.json`, in `"scripts"`:

```json
"probe:account": "tsx src/cli/probe-account.ts"
```

- [ ] **Step 2: Implement probe**

Create `src/cli/probe-account.ts`:

```ts
/* eslint-disable no-console */
import { config } from '../config/config';
import { CoinDCXApi } from '../gateways/coindcx-api';
import { connectWs } from '../gateways/coindcx-ws';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, arr) => {
    if (a.startsWith('--') && i + 1 < arr.length) acc.push([a.slice(2), arr[i + 1]!]);
    return acc;
  }, []),
);
const durationSec = Number(args.duration ?? 60);

async function main() {
  console.error(`[probe-account] duration=${durationSec}s`);
  const ws = connectWs({ apiKey: config.apiKey, apiSecret: config.apiSecret });
  ws.on('df-position-update', raw => console.log(JSON.stringify({ ch: 'position', raw })));
  ws.on('df-order-update', raw => console.log(JSON.stringify({ ch: 'order', raw })));
  ws.on('balance-update', raw => console.log(JSON.stringify({ ch: 'balance', raw })));
  ws.on('df-trade-update', raw => console.log(JSON.stringify({ ch: 'fill', raw })));
  ws.connect();

  const restPositions = await CoinDCXApi.getFuturesPositions();
  const restBalances = await CoinDCXApi.getBalances();
  const restOrders = await CoinDCXApi.getOpenOrders();
  const restTrades = await CoinDCXApi.getFuturesTradeHistory({ size: 50 });
  console.error('[probe-account][rest] positions sample:', JSON.stringify(restPositions).slice(0, 800));
  console.error('[probe-account][rest] balances sample:', JSON.stringify(restBalances).slice(0, 400));
  console.error('[probe-account][rest] orders sample:', JSON.stringify(restOrders).slice(0, 400));
  console.error('[probe-account][rest] trades sample:', JSON.stringify(restTrades).slice(0, 800));

  await new Promise(r => setTimeout(r, durationSec * 1000));
  console.error('[probe-account] done');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

If `connectWs` is named differently (verify by `grep -n 'export.*connect\|connectWs' src/gateways/coindcx-ws.ts`), use the actual export.

- [ ] **Step 3: Smoke test**

Run: `npm run probe:account -- --duration 5`
Expected: REST samples + at least the channel header lines stream to stdout for 5 seconds, then process exits.

- [ ] **Step 4: Commit**

```bash
git add src/cli/probe-account.ts package.json
git commit -m "feat(f3): probe-account script for raw account-channel capture"
```

---

## Task 19: Integration test (real Postgres, mocked WS+REST)

**Files:**
- Create: `tests/account/reconcile-controller.int.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/account/reconcile-controller.int.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { AccountReconcileController } from '../../src/account/reconcile-controller';
import { AccountPersistence } from '../../src/account/persistence';
import { SignalBus } from '../../src/signals/bus';

const DOCKER_OFF = process.env.SKIP_DOCKER_TESTS === '1';
const skip = DOCKER_OFF ? describe.skip : describe;

const PG = process.env.PG_URL ?? 'postgres://postgres:postgres@localhost:5432/coindcx';

skip('AccountReconcileController integration', () => {
  let pool: Pool;
  let persistence: AccountPersistence;
  let bus: SignalBus;
  const sinkEmit = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    bus = new SignalBus({ pool, sinks: [{ name: 'memory', emit: sinkEmit }] });
    persistence = new AccountPersistence({ pool, retryMax: 1000 });
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query('TRUNCATE positions, balances, orders, fills_ledger, account_changelog CASCADE');
    sinkEmit.mockClear();
  });

  function rest(stub: Partial<{ positions: any[]; balances: any[]; orders: any[]; trades: any[] }>) {
    return {
      getFuturesPositions: vi.fn().mockResolvedValue({ data: stub.positions ?? [] }),
      getBalances: vi.fn().mockResolvedValue(stub.balances ?? []),
      getOpenOrders: vi.fn().mockResolvedValue({ data: stub.orders ?? [] }),
      getFuturesTradeHistory: vi.fn().mockResolvedValue({ data: stub.trades ?? [] }),
    };
  }

  const cfg = {
    driftSweepMs: 1_000_000,
    heartbeatFloors: { position: 100_000, balance: 100_000, order: 100_000, fill: 100_000 },
    pnlAlarmPct: -0.10, utilAlarmPct: 0.90,
    divergencePnlAbsAlarm: 100, divergencePnlPctAlarm: 0.01,
    backfillHours: 24, signalCooldownMs: 100_000,
    stormThreshold: 20, stormWindowMs: 60_000,
  };

  it('seed populates Postgres rows', async () => {
    const restApi = rest({
      positions: [{ id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' }],
      balances: [{ currency_short_name: 'USDT', balance: 100, locked_balance: 0 }],
    });
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    await c.seed();
    const positions = await pool.query('SELECT * FROM positions');
    expect(positions.rows).toHaveLength(1);
    expect(positions.rows[0]!.id).toBe('p1');
  });

  it('divergence alarm signal emitted when REST disagrees', async () => {
    const restApi = rest({
      positions: [{ id: 'p1', pair: 'X', active_pos: 0.5, avg_price: 50, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' }],
    });
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 1.0, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' });
    await c.forcedSweep('position');
    const types = sinkEmit.mock.calls.map(call => (call[0] as any).type);
    expect(types).toContain('reconcile.divergence');
    const cl = await pool.query("SELECT * FROM account_changelog WHERE cause='divergence'");
    expect(cl.rows.length).toBeGreaterThan(0);
  });

  it('idempotent fill replay results in single row', async () => {
    const restApi = rest({});
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    const raw = { id: 'fA', pair: 'X', side: 'buy', price: 1, quantity: 1, executed_at: '2026-04-26T00:00:00Z' };
    await c.ingest('fill', raw);
    await c.ingest('fill', raw);
    await c.ingest('fill', raw);
    const fills = await pool.query('SELECT * FROM fills_ledger');
    expect(fills.rows).toHaveLength(1);
    const fillSignals = sinkEmit.mock.calls.filter(c => (c[0] as any).type === 'fill.executed');
    expect(fillSignals.length).toBe(1);
  });

  it('synthesized close emits position.closed when REST sweep finds row gone', async () => {
    const restApi = rest({ positions: [] });
    const c = new AccountReconcileController({ restApi: restApi as any, persistence, signalBus: bus, tryAcquireBudget: async () => true, config: cfg });
    await c.ingest('position', { id: 'p1', pair: 'X', active_pos: 1, avg_price: 50,
      margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' });
    await c.forcedSweep('position');
    const types = sinkEmit.mock.calls.map(call => (call[0] as any).type);
    expect(types).toContain('position.closed');
  });
});
```

- [ ] **Step 2: Run integration tests (Postgres up)**

Run: `docker compose up -d && npm run db:migrate && npx vitest run tests/account/reconcile-controller.int.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Verify Docker-skip works**

Run: `SKIP_DOCKER_TESTS=1 npx vitest run tests/account/reconcile-controller.int.test.ts`
Expected: tests skipped, suite passes.

- [ ] **Step 4: Commit**

```bash
git add tests/account/reconcile-controller.int.test.ts
git commit -m "test(f3): integration tests for reconcile controller"
```

---

## Task 20: Quality gate + README phase update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run full quality gate**

Run: `npm run check`
Expected: typecheck + lint + tests all pass.

If any failure: fix in place; do NOT proceed without green.

- [ ] **Step 2: Update README phase status**

In `README.md`, replace the "Phases" block. Move F2 to shipped, add F3 as current:

```markdown
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
- Latency histograms, Time-sync, Always-on TailBuffer + probe CLI

### Phase 3: Account state reconciler (current)
- Per-entity stores (positions, balances, orders) + fills ledger
- WS-first ingest with heartbeat-driven forced sweeps and 5-minute drift sweep
- Divergence detector with severity classification
- Audit changelog and full Postgres history (orders ↔ fills ↔ positions linkage)
- Lifecycle, threshold, and divergence signals on the SignalBus
- Read-only forever — only signed-read endpoints used

## Roadmap

- F4: strategy/signal framework + backtester
- F5: risk-alert engine
- F6: TUI v2 + Prometheus metrics
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(f3): update README phase status"
```

- [ ] **Step 4: Final verification**

Run: `npm run check`
Expected: green.

Confirm spec acceptance criteria: bot runs 1 hour with controller wired in; positions, balances, and orders panels in TUI match CoinDCX web UI exactly; logs show drift sweeps every 5 minutes with `severity=null` changelog rows when steady-state.

---

## Notes for the implementer

- Keep `state.positions` / `state.balanceMap` / `state.orders` Maps in `index.ts` only as long as Task 17 hasn't fully replaced their consumers. Once Task 17 ships and the bot runs cleanly for a soak period, delete the legacy Maps and the 30s REST-poll fallback in a follow-up cleanup commit.
- If a CoinDCX field name turns out to differ from what `normalizers.ts` assumes (verify with `npm run probe:account -- --duration 30`), update the normalizer and add a focused unit test capturing the actual payload shape.
- Read-only guard remains untouched — `/futures/orders` and `/futures/trade_history` are already on the signed-read allowlist (`src/safety/read-only-guard.ts:35-45`).
- Storm suppression triggers on alarm count, not on warn/info — be careful when tuning `stormThreshold` against drift-sweep noise.
