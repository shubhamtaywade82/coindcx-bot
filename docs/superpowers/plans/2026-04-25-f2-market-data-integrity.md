# F2 Market Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a trustworthy market-data layer with L2 orderbook integrity, heartbeat watchdog, stale-feed alarms, latency histograms, and exchange/NTP time-sync. Read-only. Emits alerts via F1's SignalBus.

**Architecture:** A single `IntegrityController` ingests WS frames, fans them out to per-pair `OrderBook` instances and a set of health monitors. Gap detection is heuristic (checksum vs REST + logical anomaly) with a strict-seq mode reserved for after the probe captures real schemas. Resync goes WS-first, REST-fallback, all rate-limited.

**Tech Stack:** TypeScript (strict) · Node 20+ · vitest · nock · fast-check (property tests) · ntp-client · existing `pg`, `pino`, `axios`, `socket.io-client@2.4`.

---

## Pre-flight

Read first:
- `docs/superpowers/specs/2026-04-25-f2-market-data-integrity-design.md`
- F1 source: `src/lifecycle/bootstrap.ts`, `src/audit/audit.ts`, `src/signals/bus.ts`, `src/safety/read-only-guard.ts`
- Existing depth handlers in `src/index.ts` (search `depth-snapshot`, `depth-update`) — replaced by `IntegrityController` in Task 12
- WS gateway: `src/gateways/coindcx-ws.ts` (subscribe / event names)
- API gateway: `src/gateways/coindcx-api.ts` — REST resync goes through `http` here

Hard rule: **no write endpoints**. REST resync uses GET only; ReadOnlyGuard already permits `/exchange/v1/derivatives/data/orderbook` (it's GET).

---

## File Structure

New files:
- `src/marketdata/types.ts` — shared types (`PriceLevel`, `BookState`, `Channel`, etc.)
- `src/marketdata/probe/tail-buffer.ts`
- `src/marketdata/probe/probe-recorder.ts`
- `src/cli/probe.ts` — CLI entrypoint
- `src/marketdata/rate-limit/rest-budget.ts`
- `src/marketdata/book/orderbook.ts`
- `src/marketdata/book/book-manager.ts`
- `src/marketdata/book/resync.ts`
- `src/marketdata/health/heartbeat.ts`
- `src/marketdata/health/latency.ts`
- `src/marketdata/health/stale-watcher.ts`
- `src/marketdata/health/time-sync.ts`
- `src/marketdata/integrity-controller.ts`
- `tests/marketdata/**/*.test.ts` — mirrored

Modified files:
- `src/index.ts` — remove naive `depth-snapshot` / `depth-update` handlers, wire `IntegrityController` from `runApp`
- `src/tui/app.ts` — replace mocked `LAT: 24ms` with real value from `LatencyTracker`
- `src/config/schema.ts` — add F2 env vars
- `package.json` — `npm run probe` script + `ntp-client` + `fast-check` deps
- `README.md` — F2 section

---

## Task 1: F2 config schema additions + dependencies

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install --save ntp-client
npm install --save-dev @types/ntp-client fast-check
```

- [ ] **Step 2: Add F2 fields to `src/config/schema.ts`**

Add inside `ConfigSchema = z.object({...})` before the `.superRefine`:

```ts
  RESYNC_WS_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  REST_BUDGET_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  REST_BUDGET_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(6),
  REST_BUDGET_PAIR_PER_MIN: z.coerce.number().int().positive().default(1),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(35000),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  STALE_FLOOR_currentPrices: z.coerce.number().int().positive().default(5000),
  STALE_FLOOR_newTrade: z.coerce.number().int().positive().default(30000),
  STALE_FLOOR_depthUpdate: z.coerce.number().int().positive().default(10000),
  CHECKSUM_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  REST_CHECKSUM_INTERVAL_MS: z.coerce.number().int().positive().default(600000),
  TIME_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
  SKEW_THRESHOLD_MS: z.coerce.number().int().positive().default(500),
  TAIL_BUFFER_SIZE: z.coerce.number().int().positive().default(1000),
  LATENCY_RESERVOIR: z.coerce.number().int().positive().default(4096),
  STALE_RESERVOIR: z.coerce.number().int().positive().default(1024),
  BOOK_INTEGRITY_MODE: z.enum(['heuristic', 'strict']).default('heuristic'),
```

- [ ] **Step 3: Append to `.env.example`**

```
# F2 Market Data Integrity
RESYNC_WS_TIMEOUT_MS=3000
REST_BUDGET_TIMEOUT_MS=5000
REST_BUDGET_GLOBAL_PER_MIN=6
REST_BUDGET_PAIR_PER_MIN=1
HEARTBEAT_TIMEOUT_MS=35000
HEARTBEAT_INTERVAL_MS=15000
STALE_FLOOR_currentPrices=5000
STALE_FLOOR_newTrade=30000
STALE_FLOOR_depthUpdate=10000
CHECKSUM_INTERVAL_MS=30000
REST_CHECKSUM_INTERVAL_MS=600000
TIME_SYNC_INTERVAL_MS=900000
SKEW_THRESHOLD_MS=500
TAIL_BUFFER_SIZE=1000
LATENCY_RESERVOIR=4096
STALE_RESERVOIR=1024
BOOK_INTEGRITY_MODE=heuristic
```

- [ ] **Step 4: Add npm script to `package.json`**

In `scripts`:
```json
"probe": "ts-node src/cli/probe.ts"
```

- [ ] **Step 5: Add shared types `src/marketdata/types.ts`**

```ts
export type Channel =
  | 'depth-snapshot'
  | 'depth-update'
  | 'new-trade'
  | 'currentPrices@futures#update'
  | 'currentPrices@spot#update';

export type BookState = 'init' | 'live' | 'resyncing' | 'broken';

export interface PriceLevel { price: string; qty: string }

export interface RawFrame {
  ts: number;          // ms epoch when received
  channel: Channel;
  raw: unknown;
}

export interface BookTopN { asks: PriceLevel[]; bids: PriceLevel[] }
```

- [ ] **Step 6: Confirm tests still pass**

Run: `npm test`
Expected: 37 tests pass (no new tests yet, just config + types).

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/marketdata/types.ts .env.example package.json package-lock.json
git commit -m "chore(f2): config schema, deps, npm run probe scaffold"
```

---

## Task 2: TailBuffer (always-on raw-frame ring)

**Files:**
- Create: `src/marketdata/probe/tail-buffer.ts`
- Test: `tests/marketdata/probe/tail-buffer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TailBuffer } from '../../../src/marketdata/probe/tail-buffer';

describe('TailBuffer', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tail-')); });

  it('caps buffer at capacity and drops oldest', () => {
    const tb = new TailBuffer({ capacity: 3, dir });
    for (let i = 0; i < 5; i++) tb.push('depth-update', { ts: i, raw: { i } });
    const out = tb.snapshot('depth-update');
    expect(out.map((f) => f.ts)).toEqual([2, 3, 4]);
  });

  it('isolates per channel', () => {
    const tb = new TailBuffer({ capacity: 5, dir });
    tb.push('depth-update', { ts: 1, raw: {} });
    tb.push('new-trade',     { ts: 2, raw: {} });
    expect(tb.snapshot('depth-update')).toHaveLength(1);
    expect(tb.snapshot('new-trade')).toHaveLength(1);
  });

  it('dump writes JSONL files per channel', async () => {
    const tb = new TailBuffer({ capacity: 5, dir });
    tb.push('depth-update', { ts: 1, raw: { a: 1 } });
    tb.push('new-trade',     { ts: 2, raw: { b: 2 } });
    const written = await tb.dump();
    expect(written.length).toBe(2);
    for (const f of written) {
      const lines = readFileSync(f, 'utf8').trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]!)).toHaveProperty('raw');
    }
  });
});
```

Run: `npx vitest run tests/marketdata/probe/tail-buffer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/marketdata/probe/tail-buffer.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Channel, RawFrame } from '../types';

export interface TailBufferOptions {
  capacity: number;
  dir: string;
}

export class TailBuffer {
  private rings = new Map<string, RawFrame[]>();

  constructor(private readonly opts: TailBufferOptions) {
    mkdirSync(opts.dir, { recursive: true });
  }

  push(channel: Channel | string, frame: { ts: number; raw: unknown }): void {
    let ring = this.rings.get(channel);
    if (!ring) {
      ring = [];
      this.rings.set(channel, ring);
    }
    ring.push({ ts: frame.ts, channel: channel as Channel, raw: frame.raw });
    if (ring.length > this.opts.capacity) ring.shift();
  }

  snapshot(channel: Channel | string): RawFrame[] {
    return [...(this.rings.get(channel) ?? [])];
  }

  async dump(channel?: Channel | string): Promise<string[]> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const channels = channel ? [channel] : Array.from(this.rings.keys());
    const written: string[] = [];
    for (const ch of channels) {
      const safe = String(ch).replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = join(this.opts.dir, `tail-${safe}-${ts}.jsonl`);
      const ring = this.rings.get(ch) ?? [];
      writeFileSync(file, ring.map((f) => JSON.stringify(f)).join('\n') + '\n');
      written.push(file);
    }
    return written;
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/probe/tail-buffer.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/probe/tail-buffer.ts tests/marketdata/probe/tail-buffer.test.ts
git commit -m "feat(f2): always-on TailBuffer with per-channel ring + JSONL dump"
```

---

## Task 3: Probe CLI

**Files:**
- Create: `src/marketdata/probe/probe-recorder.ts`
- Create: `src/cli/probe.ts`

- [ ] **Step 1: Implement `src/marketdata/probe/probe-recorder.ts`**

```ts
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

export interface ProbeRecorderOptions {
  dir: string;
  pair: string;
  channels: string[];
  durationMs: number;
}

export class ProbeRecorder {
  private stream: WriteStream;
  private started = Date.now();
  private timer?: NodeJS.Timeout;

  constructor(private readonly opts: ProbeRecorderOptions) {
    mkdirSync(opts.dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safePair = opts.pair.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.stream = createWriteStream(
      join(opts.dir, `probe-${safePair}-${ts}.jsonl`),
      { flags: 'a' },
    );
  }

  record(channel: string, raw: unknown): void {
    if (!this.opts.channels.includes(channel)) return;
    this.stream.write(JSON.stringify({ ts: Date.now(), channel, raw }) + '\n');
  }

  scheduleStop(onStop: () => void): void {
    this.timer = setTimeout(() => {
      this.stream.end(() => onStop());
    }, this.opts.durationMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.stream.end();
  }

  elapsedMs(): number {
    return Date.now() - this.started;
  }
}
```

- [ ] **Step 2: Implement `src/cli/probe.ts`**

```ts
import { loadConfig } from '../config';
import { CoinDCXWs } from '../gateways/coindcx-ws';
import { ProbeRecorder } from '../marketdata/probe/probe-recorder';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] ?? '';
      args[k] = v;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pair = args.pair ?? 'B-SOL_USDT';
  const durationMs = Number(args.duration ?? '60') * 1000;
  const channels = (args.channels ?? 'depth-snapshot,depth-update,new-trade,currentPrices@futures#update')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const cfg = loadConfig();
  const rec = new ProbeRecorder({ dir: cfg.LOG_DIR, pair, channels, durationMs });
  const ws = new CoinDCXWs();

  for (const ch of channels) {
    ws.on(ch, (raw: unknown) => rec.record(ch, raw));
  }

  ws.connect();
  // eslint-disable-next-line no-console
  console.error(`probe: ${pair} for ${durationMs}ms, channels=${channels.join(',')}`);

  rec.scheduleStop(() => {
    // eslint-disable-next-line no-console
    console.error(`probe: done in ${rec.elapsedMs()}ms`);
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('probe fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Manual smoke test (optional, requires real WS)**

Run: `npm run probe -- --pair B-SOL_USDT --duration 5`
Expected: file `logs/probe-B_SOL_USDT-*.jsonl` created with at least one frame. If the user has no `.env` set up, this is OK — the engineer notes it and moves on.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/probe/probe-recorder.ts src/cli/probe.ts
git commit -m "feat(f2): probe CLI captures raw WS frames to JSONL"
```

---

## Task 4: RestBudget (token bucket guarding REST resync)

**Files:**
- Create: `src/marketdata/rate-limit/rest-budget.ts`
- Test: `tests/marketdata/rate-limit/rest-budget.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { RestBudget } from '../../../src/marketdata/rate-limit/rest-budget';

describe('RestBudget', () => {
  it('grants global tokens up to capacity', async () => {
    let now = 0;
    const b = new RestBudget({ globalPerMin: 2, pairPerMin: 10, timeoutMs: 100, now: () => now });
    expect(await b.acquire('p1').then(() => true).catch(() => false)).toBe(true);
    expect(await b.acquire('p2').then(() => true).catch(() => false)).toBe(true);
    expect(await b.acquire('p3').then(() => true).catch(() => false)).toBe(false);
  });

  it('grants per-pair tokens up to per-pair capacity', async () => {
    let now = 0;
    const b = new RestBudget({ globalPerMin: 100, pairPerMin: 1, timeoutMs: 100, now: () => now });
    expect(await b.acquire('p1').then(() => true).catch(() => false)).toBe(true);
    expect(await b.acquire('p1').then(() => true).catch(() => false)).toBe(false);
    expect(await b.acquire('p2').then(() => true).catch(() => false)).toBe(true);
  });

  it('refills over time', async () => {
    let now = 0;
    const b = new RestBudget({ globalPerMin: 1, pairPerMin: 10, timeoutMs: 0, now: () => now });
    await b.acquire('p1');
    expect(await b.acquire('p2').catch(() => 'no')).toBe('no');
    now += 60_000;
    expect(await b.acquire('p2').then(() => 'yes').catch(() => 'no')).toBe('yes');
  });
});
```

Run: `npx vitest run tests/marketdata/rate-limit/rest-budget.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/rate-limit/rest-budget.ts`**

```ts
export interface RestBudgetOptions {
  globalPerMin: number;
  pairPerMin: number;
  timeoutMs: number;
  now?: () => number;
}

interface Bucket { tokens: number; cap: number; refillPerSec: number; last: number; }

export class RestBudgetExhausted extends Error {
  constructor(public readonly pair: string) {
    super(`Rest budget exhausted for ${pair}`);
    this.name = 'RestBudgetExhausted';
  }
}

export class RestBudget {
  private global: Bucket;
  private perPair = new Map<string, Bucket>();
  private nowFn: () => number;

  constructor(private readonly opts: RestBudgetOptions) {
    this.nowFn = opts.now ?? Date.now;
    this.global = this.makeBucket(opts.globalPerMin);
  }

  private makeBucket(perMin: number): Bucket {
    return {
      tokens: perMin,
      cap: perMin,
      refillPerSec: perMin / 60,
      last: this.nowFn(),
    };
  }

  private refill(b: Bucket): void {
    const t = this.nowFn();
    const elapsed = (t - b.last) / 1000;
    b.tokens = Math.min(b.cap, b.tokens + elapsed * b.refillPerSec);
    b.last = t;
  }

  async acquire(pair: string): Promise<void> {
    const deadline = this.nowFn() + this.opts.timeoutMs;
    while (true) {
      let pb = this.perPair.get(pair);
      if (!pb) { pb = this.makeBucket(this.opts.pairPerMin); this.perPair.set(pair, pb); }
      this.refill(this.global);
      this.refill(pb);
      if (this.global.tokens >= 1 && pb.tokens >= 1) {
        this.global.tokens -= 1;
        pb.tokens -= 1;
        return;
      }
      if (this.nowFn() >= deadline) throw new RestBudgetExhausted(pair);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/rate-limit/rest-budget.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/rate-limit/ tests/marketdata/rate-limit/
git commit -m "feat(f2): RestBudget token bucket with global + per-pair limits"
```

---

## Task 5: OrderBook (apply, checksum, state)

**Files:**
- Create: `src/marketdata/book/orderbook.ts`
- Test: `tests/marketdata/book/orderbook.test.ts`
- Test: `tests/marketdata/book/orderbook.property.test.ts`

- [ ] **Step 1: Write unit tests**

```ts
import { describe, it, expect } from 'vitest';
import { OrderBook } from '../../../src/marketdata/book/orderbook';

describe('OrderBook', () => {
  it('starts in init state', () => {
    expect(new OrderBook('B-SOL_USDT').state()).toBe('init');
  });

  it('snapshot transitions to live and best bid/ask correct', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot([['86.5700', '5'], ['86.5800', '10']], [['86.5600', '7'], ['86.5500', '3']], 1);
    expect(b.state()).toBe('live');
    expect(b.bestAsk()?.price).toBe('86.5700');
    expect(b.bestBid()?.price).toBe('86.5600');
  });

  it('delta with qty=0 deletes level', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot([['86.5700', '5']], [['86.5600', '7']], 1);
    b.applyDelta([['86.5700', '0']], [], 2);
    expect(b.bestAsk()).toBeUndefined();
  });

  it('delta deleting unknown price emits gap', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot([['86.5700', '5']], [['86.5600', '7']], 1);
    let gap = false;
    b.on('gap', () => { gap = true; });
    b.applyDelta([['90.0000', '0']], [], 2);
    expect(gap).toBe(true);
  });

  it('checksum changes when book changes and is stable for same content', () => {
    const a = new OrderBook('B-SOL_USDT');
    const b = new OrderBook('B-SOL_USDT');
    a.applySnapshot([['1', '1']], [['0.5', '1']], 1);
    b.applySnapshot([['1', '1']], [['0.5', '1']], 1);
    expect(a.checksum()).toBe(b.checksum());
    a.applyDelta([['1', '2']], [], 2);
    expect(a.checksum()).not.toBe(b.checksum());
  });

  it('topN returns asks ascending and bids descending', () => {
    const b = new OrderBook('B-SOL_USDT');
    b.applySnapshot(
      [['100', '1'], ['90', '1'], ['110', '1']],
      [['80', '1'], ['85', '1'], ['70', '1']],
      1,
    );
    const top = b.topN(2);
    expect(top.asks.map((l) => l.price)).toEqual(['90', '100']);
    expect(top.bids.map((l) => l.price)).toEqual(['85', '80']);
  });
});
```

Run: `npx vitest run tests/marketdata/book/orderbook.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/book/orderbook.ts`**

```ts
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { BookState, BookTopN, PriceLevel } from '../types';

type Levels = Map<string, string>;

export class OrderBook extends EventEmitter {
  private asks: Levels = new Map();
  private bids: Levels = new Map();
  private _state: BookState = 'init';
  private lastSeq = 0;
  private lastTs = 0;

  constructor(public readonly pair: string) { super(); }

  state(): BookState { return this._state; }
  setState(s: BookState): void { this._state = s; }

  applySnapshot(asks: Array<[string, string]>, bids: Array<[string, string]>, ts: number, seq?: number): void {
    this.asks.clear();
    this.bids.clear();
    for (const [p, q] of asks) if (parseFloat(q) > 0) this.asks.set(p, q);
    for (const [p, q] of bids) if (parseFloat(q) > 0) this.bids.set(p, q);
    this.lastTs = ts;
    if (seq !== undefined) this.lastSeq = seq;
    this._state = 'live';
    this.emit('snapshot');
  }

  applyDelta(asks: Array<[string, string]>, bids: Array<[string, string]>, ts: number, seq?: number, prevSeq?: number): void {
    if (seq !== undefined && prevSeq !== undefined && prevSeq !== this.lastSeq) {
      this.emit('gap', { reason: 'seq_mismatch', expected: this.lastSeq, prevSeq });
      return;
    }
    for (const [p, q] of asks) {
      if (parseFloat(q) === 0) {
        if (!this.asks.has(p)) {
          this.emit('gap', { reason: 'delete_unknown_ask', price: p });
          return;
        }
        this.asks.delete(p);
      } else {
        this.asks.set(p, q);
      }
    }
    for (const [p, q] of bids) {
      if (parseFloat(q) === 0) {
        if (!this.bids.has(p)) {
          this.emit('gap', { reason: 'delete_unknown_bid', price: p });
          return;
        }
        this.bids.delete(p);
      } else {
        this.bids.set(p, q);
      }
    }
    this.lastTs = ts;
    if (seq !== undefined) this.lastSeq = seq;
    this.emit('applied');
  }

  topN(n: number): BookTopN {
    const asks = [...this.asks.entries()]
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .slice(0, n)
      .map(([price, qty]) => ({ price, qty }));
    const bids = [...this.bids.entries()]
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .slice(0, n)
      .map(([price, qty]) => ({ price, qty }));
    return { asks, bids };
  }

  bestAsk(): PriceLevel | undefined { return this.topN(1).asks[0]; }
  bestBid(): PriceLevel | undefined { return this.topN(1).bids[0]; }

  spread(): number | undefined {
    const a = this.bestAsk(); const b = this.bestBid();
    return a && b ? parseFloat(a.price) - parseFloat(b.price) : undefined;
  }

  midPrice(): number | undefined {
    const a = this.bestAsk(); const b = this.bestBid();
    return a && b ? (parseFloat(a.price) + parseFloat(b.price)) / 2 : undefined;
  }

  checksum(): string {
    const top = this.topN(25);
    const lines = [
      ...top.asks.map((l) => `A:${l.price}:${l.qty}`),
      ...top.bids.map((l) => `B:${l.price}:${l.qty}`),
    ];
    return createHash('sha1').update(lines.join('\n')).digest('hex');
  }

  lastSequence(): number { return this.lastSeq; }
  lastTimestamp(): number { return this.lastTs; }
}
```

- [ ] **Step 3: Run unit tests, expect pass**

Run: `npx vitest run tests/marketdata/book/orderbook.test.ts`
Expected: 6 PASS.

- [ ] **Step 4: Write property test**

Create `tests/marketdata/book/orderbook.property.test.ts`:

```ts
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { OrderBook } from '../../../src/marketdata/book/orderbook';

describe('OrderBook (property)', () => {
  it('checksum is stable across two books built from same operations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('A', 'B'),
            fc.float({ min: 1, max: 100, noNaN: true }).map((n) => n.toFixed(4)),
            fc.float({ min: 0, max: 10, noNaN: true }).map((n) => n.toFixed(4)),
          ),
          { maxLength: 50 },
        ),
        (ops) => {
          const a = new OrderBook('X');
          const b = new OrderBook('X');
          a.applySnapshot([], [], 1);
          b.applySnapshot([], [], 1);
          let seq = 2;
          for (const [side, price, qty] of ops) {
            const asks: Array<[string, string]> = side === 'A' ? [[price, qty]] : [];
            const bids: Array<[string, string]> = side === 'B' ? [[price, qty]] : [];
            // skip ops that delete unknown levels (would emit 'gap' and skip update)
            if (parseFloat(qty) === 0) continue;
            a.applyDelta(asks, bids, seq);
            b.applyDelta(asks, bids, seq);
            seq++;
          }
          return a.checksum() === b.checksum();
        },
      ),
      { numRuns: 50 },
    );
  });
});
```

Run: `npx vitest run tests/marketdata/book/orderbook.property.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/book/orderbook.ts tests/marketdata/book/
git commit -m "feat(f2): OrderBook with snapshot/delta/checksum/state machine"
```

---

## Task 6: BookManager

**Files:**
- Create: `src/marketdata/book/book-manager.ts`
- Test: `tests/marketdata/book/book-manager.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { BookManager } from '../../../src/marketdata/book/book-manager';

describe('BookManager', () => {
  it('creates a book per pair on first snapshot', () => {
    const m = new BookManager();
    m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [['0.5','1']], ts: 1 });
    expect(m.get('B-SOL_USDT')!.bestAsk()?.price).toBe('1');
  });

  it('routes deltas to correct book', () => {
    const m = new BookManager();
    m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [], ts: 1 });
    m.onDepthSnapshot('B-ETH_USDT', { asks: [['2','1']], bids: [], ts: 1 });
    m.onDepthDelta('B-SOL_USDT', { asks: [['1','5']], bids: [], ts: 2 });
    expect(m.get('B-SOL_USDT')!.bestAsk()?.qty).toBe('5');
    expect(m.get('B-ETH_USDT')!.bestAsk()?.qty).toBe('1');
  });

  it('emits gap event with pair', () => {
    const m = new BookManager();
    m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [], ts: 1 });
    let captured: any;
    m.on('gap', (e) => { captured = e; });
    m.onDepthDelta('B-SOL_USDT', { asks: [['9','0']], bids: [], ts: 2 });
    expect(captured.pair).toBe('B-SOL_USDT');
    expect(captured.reason).toBe('delete_unknown_ask');
  });
});
```

Run: `npx vitest run tests/marketdata/book/book-manager.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/book/book-manager.ts`**

```ts
import { EventEmitter } from 'node:events';
import { OrderBook } from './orderbook';

export interface DepthFrame {
  asks: Array<[string, string]>;
  bids: Array<[string, string]>;
  ts: number;
  seq?: number;
  prevSeq?: number;
}

export class BookManager extends EventEmitter {
  private books = new Map<string, OrderBook>();

  get(pair: string): OrderBook | undefined { return this.books.get(pair); }
  pairs(): string[] { return [...this.books.keys()]; }

  private getOrCreate(pair: string): OrderBook {
    let b = this.books.get(pair);
    if (!b) {
      b = new OrderBook(pair);
      b.on('gap', (e) => this.emit('gap', { pair, ...e }));
      this.books.set(pair, b);
    }
    return b;
  }

  onDepthSnapshot(pair: string, frame: DepthFrame): void {
    const b = this.getOrCreate(pair);
    b.applySnapshot(frame.asks, frame.bids, frame.ts, frame.seq);
  }

  onDepthDelta(pair: string, frame: DepthFrame): void {
    const b = this.getOrCreate(pair);
    if (b.state() === 'init') {
      this.emit('gap', { pair, reason: 'delta_before_snapshot' });
      return;
    }
    b.applyDelta(frame.asks, frame.bids, frame.ts, frame.seq, frame.prevSeq);
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/book/book-manager.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/book/book-manager.ts tests/marketdata/book/book-manager.test.ts
git commit -m "feat(f2): BookManager routes per-pair depth events and lifts gap events"
```

---

## Task 7: ResyncOrchestrator

**Files:**
- Create: `src/marketdata/book/resync.ts`
- Test: `tests/marketdata/book/resync.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ResyncOrchestrator } from '../../../src/marketdata/book/resync';
import { BookManager } from '../../../src/marketdata/book/book-manager';
import { RestBudget } from '../../../src/marketdata/rate-limit/rest-budget';

function makeMgr(): BookManager {
  const m = new BookManager();
  m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [['0.5','1']], ts: 1 });
  return m;
}

describe('ResyncOrchestrator', () => {
  it('falls back to REST when WS resub times out', async () => {
    const mgr = makeMgr();
    const budget = new RestBudget({ globalPerMin: 10, pairPerMin: 10, timeoutMs: 100 });
    const restFetch = vi.fn(async (_pair: string) => ({
      asks: [['2','2']] as Array<[string,string]>,
      bids: [['1.5','2']] as Array<[string,string]>,
      ts: 99,
    }));
    const wsResub = vi.fn(async (_pair: string) => { /* never sends snapshot */ });

    const orch = new ResyncOrchestrator({
      manager: mgr, budget, restFetch, wsResubscribe: wsResub, wsTimeoutMs: 20,
    });
    const events: any[] = [];
    orch.on('resynced', (e) => events.push(e));

    await orch.requestResync('B-SOL_USDT', 'test');
    expect(restFetch).toHaveBeenCalledWith('B-SOL_USDT');
    expect(mgr.get('B-SOL_USDT')!.bestAsk()?.price).toBe('2');
    expect(events[0].viaRest).toBe(true);
  });

  it('emits failed when budget exhausted', async () => {
    const mgr = makeMgr();
    const budget = new RestBudget({ globalPerMin: 0, pairPerMin: 0, timeoutMs: 0 });
    const orch = new ResyncOrchestrator({
      manager: mgr, budget,
      restFetch: vi.fn(),
      wsResubscribe: vi.fn(),
      wsTimeoutMs: 5,
    });
    const fails: any[] = [];
    orch.on('failed', (e) => fails.push(e));
    await orch.requestResync('B-SOL_USDT', 'test');
    expect(fails.length).toBe(1);
  });
});
```

Run: `npx vitest run tests/marketdata/book/resync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/marketdata/book/resync.ts`**

```ts
import { EventEmitter } from 'node:events';
import type { BookManager, DepthFrame } from './book-manager';
import { RestBudget, RestBudgetExhausted } from '../rate-limit/rest-budget';

export interface ResyncOptions {
  manager: BookManager;
  budget: RestBudget;
  restFetch: (pair: string) => Promise<DepthFrame>;
  wsResubscribe: (pair: string) => Promise<void>;
  wsTimeoutMs: number;
}

export class ResyncOrchestrator extends EventEmitter {
  private inFlight = new Set<string>();

  constructor(private readonly opts: ResyncOptions) { super(); }

  async requestResync(pair: string, reason: string): Promise<void> {
    if (this.inFlight.has(pair)) return;
    this.inFlight.add(pair);
    const started = Date.now();
    try {
      const book = this.opts.manager.get(pair);
      if (book) book.setState('resyncing');

      // 1. WS resubscribe race vs timeout
      const snapshotReceived = new Promise<DepthFrame | null>((resolve) => {
        const onSnap = (p: string, frame: DepthFrame) => {
          if (p === pair) {
            this.opts.manager.off('snapshotReceived', onSnap);
            resolve(frame);
          }
        };
        this.opts.manager.on('snapshotReceived', onSnap);
        setTimeout(() => {
          this.opts.manager.off('snapshotReceived', onSnap);
          resolve(null);
        }, this.opts.wsTimeoutMs);
      });
      await this.opts.wsResubscribe(pair);
      const wsFrame = await snapshotReceived;
      if (wsFrame) {
        this.emit('resynced', { pair, reason, viaRest: false, durationMs: Date.now() - started });
        return;
      }

      // 2. REST fallback under budget
      try {
        await this.opts.budget.acquire(pair);
      } catch (err) {
        if (err instanceof RestBudgetExhausted) {
          this.emit('failed', { pair, reason, error: 'budget_exhausted' });
          return;
        }
        throw err;
      }

      const frame = await this.opts.restFetch(pair);
      this.opts.manager.onDepthSnapshot(pair, frame);
      this.emit('resynced', { pair, reason, viaRest: true, durationMs: Date.now() - started });
    } catch (err) {
      this.emit('failed', { pair, reason, error: (err as Error).message });
    } finally {
      this.inFlight.delete(pair);
    }
  }
}
```

- [ ] **Step 3: Update `BookManager` to emit `snapshotReceived`**

Modify `src/marketdata/book/book-manager.ts` `onDepthSnapshot`:

```ts
  onDepthSnapshot(pair: string, frame: DepthFrame): void {
    const b = this.getOrCreate(pair);
    b.applySnapshot(frame.asks, frame.bids, frame.ts, frame.seq);
    this.emit('snapshotReceived', pair, frame);
  }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/marketdata/book/resync.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/book/resync.ts src/marketdata/book/book-manager.ts tests/marketdata/book/resync.test.ts
git commit -m "feat(f2): ResyncOrchestrator with WS-first, REST-fallback under budget"
```

---

## Task 8: Heartbeat watchdog

**Files:**
- Create: `src/marketdata/health/heartbeat.ts`
- Test: `tests/marketdata/health/heartbeat.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Heartbeat } from '../../../src/marketdata/health/heartbeat';

class FakeWs extends EventEmitter {
  reconnect = vi.fn();
}

describe('Heartbeat', () => {
  it('records pong rtt', () => {
    const ws = new FakeWs();
    const onLatency = vi.fn();
    const hb = new Heartbeat({ ws: ws as any, intervalMs: 10_000, timeoutMs: 30_000, onLatency });
    hb.start();
    hb.markPing(1000);
    ws.emit('pong', 1024);
    expect(onLatency).toHaveBeenCalledWith(24);
    hb.stop();
  });

  it('triggers timeout alert + reconnect when no pong arrives', async () => {
    const ws = new FakeWs();
    const onTimeout = vi.fn();
    const hb = new Heartbeat({
      ws: ws as any, intervalMs: 50, timeoutMs: 30, onTimeout,
    });
    hb.start();
    hb.markPing(Date.now());
    await new Promise((r) => setTimeout(r, 60));
    expect(onTimeout).toHaveBeenCalled();
    expect(ws.reconnect).toHaveBeenCalled();
    hb.stop();
  });
});
```

Run: `npx vitest run tests/marketdata/health/heartbeat.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/health/heartbeat.ts`**

```ts
import type { EventEmitter } from 'node:events';

export interface HeartbeatOptions {
  ws: EventEmitter & { reconnect: () => void };
  intervalMs: number;
  timeoutMs: number;
  onLatency?: (rttMs: number) => void;
  onTimeout?: () => void;
}

export class Heartbeat {
  private lastPing?: number;
  private timer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;

  constructor(private readonly opts: HeartbeatOptions) {}

  start(): void {
    this.opts.ws.on('pong', (t: number) => {
      if (this.lastPing !== undefined) {
        this.opts.onLatency?.(t - this.lastPing);
      }
    });
    this.timer = setInterval(() => this.markPing(Date.now()), this.opts.intervalMs);
  }

  markPing(now: number): void {
    this.lastPing = now;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.opts.onTimeout?.();
      this.opts.ws.reconnect();
    }, this.opts.timeoutMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.watchdog) clearTimeout(this.watchdog);
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/health/heartbeat.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/health/heartbeat.ts tests/marketdata/health/heartbeat.test.ts
git commit -m "feat(f2): Heartbeat watchdog with pong rtt + reconnect on timeout"
```

---

## Task 9: Latency tracker

**Files:**
- Create: `src/marketdata/health/latency.ts`
- Test: `tests/marketdata/health/latency.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { LatencyTracker } from '../../../src/marketdata/health/latency';

describe('LatencyTracker', () => {
  it('records and reports percentiles', () => {
    const lt = new LatencyTracker({ reservoirSize: 1024 });
    for (let i = 1; i <= 100; i++) lt.record('depth-update', 'tickAge', i);
    const s = lt.snapshot('depth-update', 'tickAge');
    expect(s.count).toBe(100);
    expect(s.p50).toBeGreaterThanOrEqual(45);
    expect(s.p50).toBeLessThanOrEqual(55);
    expect(s.p99).toBeGreaterThanOrEqual(95);
  });

  it('separates kinds', () => {
    const lt = new LatencyTracker({ reservoirSize: 1024 });
    lt.record('depth-update', 'wsRtt', 10);
    lt.record('depth-update', 'tickAge', 100);
    expect(lt.snapshot('depth-update', 'wsRtt').p50).toBe(10);
    expect(lt.snapshot('depth-update', 'tickAge').p50).toBe(100);
  });

  it('snapshot returns empty for unknown', () => {
    const lt = new LatencyTracker({ reservoirSize: 1024 });
    expect(lt.snapshot('nope' as any, 'wsRtt').count).toBe(0);
  });
});
```

Run: `npx vitest run tests/marketdata/health/latency.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/health/latency.ts`**

```ts
export type LatencyKind = 'wsRtt' | 'tickAge';

export interface LatencySnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LatencyOptions { reservoirSize: number; }

export class LatencyTracker {
  private reservoirs = new Map<string, number[]>();

  constructor(private readonly opts: LatencyOptions) {}

  private key(channel: string, kind: LatencyKind): string {
    return `${channel}::${kind}`;
  }

  record(channel: string, kind: LatencyKind, ms: number): void {
    const k = this.key(channel, kind);
    let arr = this.reservoirs.get(k);
    if (!arr) { arr = []; this.reservoirs.set(k, arr); }
    if (arr.length < this.opts.reservoirSize) {
      arr.push(ms);
    } else {
      const idx = Math.floor(Math.random() * (arr.length + 1));
      if (idx < arr.length) arr[idx] = ms;
    }
  }

  snapshot(channel: string, kind: LatencyKind): LatencySnapshot {
    const arr = this.reservoirs.get(this.key(channel, kind));
    if (!arr || arr.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    return {
      count: sorted.length,
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: sorted[sorted.length - 1]!,
    };
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/health/latency.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/health/latency.ts tests/marketdata/health/latency.test.ts
git commit -m "feat(f2): LatencyTracker reservoir w/ p50/p95/p99 per channel/kind"
```

---

## Task 10: Stale watcher

**Files:**
- Create: `src/marketdata/health/stale-watcher.ts`
- Test: `tests/marketdata/health/stale-watcher.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { StaleWatcher } from '../../../src/marketdata/health/stale-watcher';

describe('StaleWatcher', () => {
  it('does not alarm when within threshold', () => {
    let now = 1000;
    const w = new StaleWatcher({
      floors: { 'depth-update': 1000 },
      reservoirSize: 16,
      onStale: vi.fn(),
      now: () => now,
    });
    w.touch('depth-update', 'P');
    now = 1500;
    w.tick();
    expect((w.snapshot('depth-update', 'P')).stale).toBe(false);
  });

  it('alarms once when exceeding threshold', () => {
    let now = 1000;
    const onStale = vi.fn();
    const w = new StaleWatcher({
      floors: { 'depth-update': 200 },
      reservoirSize: 16,
      onStale,
      now: () => now,
    });
    w.touch('depth-update', 'P');
    now = 5000;
    w.tick();
    w.tick();
    expect(onStale).toHaveBeenCalledOnce();
    w.touch('depth-update', 'P');
    now = 6000;
    w.tick();
    now = 9000;
    w.tick();
    expect(onStale).toHaveBeenCalledTimes(2);
  });
});
```

Run: `npx vitest run tests/marketdata/health/stale-watcher.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/health/stale-watcher.ts`**

```ts
export interface StaleEvent { channel: string; pair: string; gapMs: number; thresholdMs: number; }

export interface StaleWatcherOptions {
  floors: Record<string, number>;
  reservoirSize: number;
  onStale: (e: StaleEvent) => void;
  now?: () => number;
}

interface ChannelState {
  lastSeen: number;
  inter: number[];           // inter-arrival samples
  alarmed: boolean;
}

export class StaleWatcher {
  private channels = new Map<string, ChannelState>();
  private nowFn: () => number;

  constructor(private readonly opts: StaleWatcherOptions) {
    this.nowFn = opts.now ?? Date.now;
  }

  private key(channel: string, pair: string): string { return `${channel}::${pair}`; }

  touch(channel: string, pair: string): void {
    const k = this.key(channel, pair);
    const t = this.nowFn();
    let cs = this.channels.get(k);
    if (!cs) {
      cs = { lastSeen: t, inter: [], alarmed: false };
      this.channels.set(k, cs);
      return;
    }
    const dt = t - cs.lastSeen;
    if (cs.inter.length < this.opts.reservoirSize) cs.inter.push(dt);
    else cs.inter[Math.floor(Math.random() * cs.inter.length)] = dt;
    cs.lastSeen = t;
    cs.alarmed = false;
  }

  private p99(samples: number[]): number {
    if (samples.length === 0) return 0;
    const s = [...samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]!;
  }

  threshold(channel: string, samples: number[]): number {
    const floor = this.opts.floors[channel] ?? 10_000;
    return Math.max(floor, 3 * this.p99(samples));
  }

  tick(): void {
    const t = this.nowFn();
    for (const [k, cs] of this.channels) {
      const [channel, pair] = k.split('::') as [string, string];
      const th = this.threshold(channel, cs.inter);
      const gap = t - cs.lastSeen;
      if (gap > th && !cs.alarmed) {
        cs.alarmed = true;
        this.opts.onStale({ channel, pair, gapMs: gap, thresholdMs: th });
      }
    }
  }

  snapshot(channel: string, pair: string): { stale: boolean; gapMs: number; thresholdMs: number } {
    const cs = this.channels.get(this.key(channel, pair));
    if (!cs) return { stale: false, gapMs: 0, thresholdMs: 0 };
    const t = this.nowFn();
    const th = this.threshold(channel, cs.inter);
    return { stale: t - cs.lastSeen > th, gapMs: t - cs.lastSeen, thresholdMs: th };
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/health/stale-watcher.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/health/stale-watcher.ts tests/marketdata/health/stale-watcher.test.ts
git commit -m "feat(f2): StaleWatcher with hybrid floor + 3xp99 threshold"
```

---

## Task 11: Time sync

**Files:**
- Create: `src/marketdata/health/time-sync.ts`
- Test: `tests/marketdata/health/time-sync.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { TimeSync } from '../../../src/marketdata/health/time-sync';

describe('TimeSync', () => {
  it('fires critical alert when skew exceeds threshold', async () => {
    const onSkew = vi.fn();
    const ts = new TimeSync({
      thresholdMs: 100,
      fetchExchangeMs: async () => 1_000_000,
      fetchNtpMs:      async () => 1_000_000,
      now: () => 1_000_500,
      onSkew,
    });
    await ts.checkOnce();
    expect(onSkew).toHaveBeenCalled();
    const arg = onSkew.mock.calls[0]![0];
    expect(arg.severity).toBe('critical');
    expect(Math.abs(arg.localVsExchange)).toBeGreaterThanOrEqual(500);
  });

  it('silent when within threshold', async () => {
    const onSkew = vi.fn();
    const ts = new TimeSync({
      thresholdMs: 1000,
      fetchExchangeMs: async () => 1_000_000,
      fetchNtpMs:      async () => 1_000_000,
      now: () => 1_000_000,
      onSkew,
    });
    await ts.checkOnce();
    expect(onSkew).not.toHaveBeenCalled();
  });

  it('warns when one source unavailable', async () => {
    const onSkew = vi.fn();
    const ts = new TimeSync({
      thresholdMs: 1000,
      fetchExchangeMs: async () => { throw new Error('down'); },
      fetchNtpMs:      async () => 1_000_000,
      now: () => 1_000_000,
      onSkew,
    });
    await ts.checkOnce();
    expect(onSkew).toHaveBeenCalled();
    expect(onSkew.mock.calls[0]![0].severity).toBe('warn');
  });
});
```

Run: `npx vitest run tests/marketdata/health/time-sync.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/marketdata/health/time-sync.ts`**

```ts
export interface SkewEvent {
  severity: 'warn' | 'critical';
  localVsExchange: number | null;
  localVsNtp: number | null;
  exchangeVsNtp: number | null;
  reason: string;
}

export interface TimeSyncOptions {
  thresholdMs: number;
  fetchExchangeMs: () => Promise<number>;
  fetchNtpMs: () => Promise<number>;
  now?: () => number;
  onSkew: (e: SkewEvent) => void;
}

export class TimeSync {
  private nowFn: () => number;

  constructor(private readonly opts: TimeSyncOptions) {
    this.nowFn = opts.now ?? Date.now;
  }

  async checkOnce(): Promise<void> {
    const local = this.nowFn();
    const [exRes, ntpRes] = await Promise.allSettled([
      this.opts.fetchExchangeMs(),
      this.opts.fetchNtpMs(),
    ]);
    const exMs = exRes.status === 'fulfilled' ? exRes.value : null;
    const ntpMs = ntpRes.status === 'fulfilled' ? ntpRes.value : null;

    const localVsExchange = exMs !== null ? local - exMs : null;
    const localVsNtp      = ntpMs !== null ? local - ntpMs : null;
    const exchangeVsNtp   = exMs !== null && ntpMs !== null ? exMs - ntpMs : null;

    if (exMs === null || ntpMs === null) {
      this.opts.onSkew({
        severity: 'warn',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: exMs === null ? 'exchange_unavailable' : 'ntp_unavailable',
      });
      return;
    }
    const worst = Math.max(
      Math.abs(localVsExchange ?? 0),
      Math.abs(localVsNtp ?? 0),
      Math.abs(exchangeVsNtp ?? 0),
    );
    if (worst > this.opts.thresholdMs) {
      this.opts.onSkew({
        severity: 'critical',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: 'skew_exceeded',
      });
    }
  }
}
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/health/time-sync.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/health/time-sync.ts tests/marketdata/health/time-sync.test.ts
git commit -m "feat(f2): TimeSync with exchange + NTP skew detection"
```

---

## Task 12: IntegrityController + wire-up

**Files:**
- Create: `src/marketdata/integrity-controller.ts`
- Modify: `src/index.ts`
- Modify: `src/lifecycle/bootstrap.ts` (return controller in Context if convenient; otherwise wire in `runApp`)
- Test: `tests/marketdata/integrity-controller.test.ts`

- [ ] **Step 1: Implement `src/marketdata/integrity-controller.ts`**

```ts
import type { Pool } from 'pg';
import type { AppLogger } from '../logging/logger';
import type { Audit } from '../audit/audit';
import type { SignalBus } from '../signals/bus';
import type { Config } from '../config';
import { ulid } from 'ulid';
import { BookManager } from './book/book-manager';
import { ResyncOrchestrator } from './book/resync';
import { RestBudget } from './rate-limit/rest-budget';
import { Heartbeat } from './health/heartbeat';
import { LatencyTracker } from './health/latency';
import { StaleWatcher } from './health/stale-watcher';
import { TimeSync } from './health/time-sync';
import { TailBuffer } from './probe/tail-buffer';

export interface IntegrityDeps {
  config: Config;
  logger: AppLogger;
  pool: Pool;
  audit: Audit;
  bus: SignalBus;
  ws: import('node:events').EventEmitter & { reconnect: () => void; subscribe?: (ch: string, pair: string) => void; unsubscribe?: (ch: string, pair: string) => void };
  restFetchOrderBook: (pair: string) => Promise<{ asks: Array<[string, string]>; bids: Array<[string, string]>; ts: number }>;
  fetchExchangeMs: () => Promise<number>;
  fetchNtpMs: () => Promise<number>;
}

export class IntegrityController {
  readonly tail: TailBuffer;
  readonly books: BookManager;
  readonly latency: LatencyTracker;
  readonly stale: StaleWatcher;
  readonly heartbeat: Heartbeat;
  readonly timeSync: TimeSync;
  readonly resync: ResyncOrchestrator;
  private staleTimer?: NodeJS.Timeout;
  private timeSyncTimer?: NodeJS.Timeout;
  private latencyTimer?: NodeJS.Timeout;

  constructor(private readonly deps: IntegrityDeps) {
    const { config, bus, audit, logger, ws } = deps;

    this.tail = new TailBuffer({ capacity: config.TAIL_BUFFER_SIZE, dir: config.LOG_DIR });
    this.books = new BookManager();
    this.latency = new LatencyTracker({ reservoirSize: config.LATENCY_RESERVOIR });
    this.stale = new StaleWatcher({
      floors: {
        'depth-update': config.STALE_FLOOR_depthUpdate,
        'new-trade': config.STALE_FLOOR_newTrade,
        'currentPrices@futures#update': config.STALE_FLOOR_currentPrices,
        'currentPrices@spot#update': config.STALE_FLOOR_currentPrices,
      },
      reservoirSize: config.STALE_RESERVOIR,
      onStale: (e) => {
        const sig = { id: ulid(), ts: new Date().toISOString(), strategy: 'integrity', type: 'stale_feed', severity: 'warn' as const, payload: e };
        void bus.emit(sig);
        audit.recordEvent({ kind: 'alert', source: 'integrity', payload: { type: 'stale_feed', ...e } });
      },
    });
    this.heartbeat = new Heartbeat({
      ws,
      intervalMs: config.HEARTBEAT_INTERVAL_MS,
      timeoutMs: config.HEARTBEAT_TIMEOUT_MS,
      onLatency: (rtt) => this.latency.record('ws', 'wsRtt', rtt),
      onTimeout: () => {
        const sig = { id: ulid(), ts: new Date().toISOString(), strategy: 'integrity', type: 'heartbeat_lost', severity: 'critical' as const, payload: {} };
        void bus.emit(sig);
        audit.recordEvent({ kind: 'alert', source: 'integrity', payload: { type: 'heartbeat_lost' } });
      },
    });
    this.timeSync = new TimeSync({
      thresholdMs: config.SKEW_THRESHOLD_MS,
      fetchExchangeMs: deps.fetchExchangeMs,
      fetchNtpMs: deps.fetchNtpMs,
      onSkew: (e) => {
        const sig = { id: ulid(), ts: new Date().toISOString(), strategy: 'integrity', type: 'clock_skew', severity: e.severity, payload: e };
        void bus.emit(sig);
        audit.recordEvent({ kind: 'alert', source: 'integrity', payload: { type: 'clock_skew', ...e } });
      },
    });
    this.resync = new ResyncOrchestrator({
      manager: this.books,
      budget: new RestBudget({
        globalPerMin: config.REST_BUDGET_GLOBAL_PER_MIN,
        pairPerMin: config.REST_BUDGET_PAIR_PER_MIN,
        timeoutMs: config.REST_BUDGET_TIMEOUT_MS,
      }),
      restFetch: async (pair) => {
        const f = await deps.restFetchOrderBook(pair);
        return { asks: f.asks, bids: f.bids, ts: f.ts };
      },
      wsResubscribe: async (pair) => {
        ws.unsubscribe?.('depth-snapshot', pair);
        ws.subscribe?.('depth-snapshot', pair);
      },
      wsTimeoutMs: config.RESYNC_WS_TIMEOUT_MS,
    });

    this.books.on('gap', (e) => {
      logger.warn({ mod: 'integrity', ...e }, 'book gap detected');
      void this.tail.dump();
      void this.resync.requestResync(e.pair, e.reason);
    });

    this.resync.on('resynced', (e) => {
      const sig = { id: ulid(), ts: new Date().toISOString(), strategy: 'integrity', type: 'book_resync', pair: e.pair, severity: 'warn' as const, payload: e };
      void bus.emit(sig);
      audit.recordEvent({ kind: 'reconcile_diff', source: 'integrity', payload: e });
    });
    this.resync.on('failed', (e) => {
      const sig = { id: ulid(), ts: new Date().toISOString(), strategy: 'integrity', type: 'book_resync_failed', pair: e.pair, severity: 'critical' as const, payload: e };
      void bus.emit(sig);
      audit.recordEvent({ kind: 'alert', source: 'integrity', payload: { type: 'book_resync_failed', ...e } });
    });
  }

  ingest(channel: string, raw: any): void {
    const ts = Date.now();
    this.tail.push(channel, { ts, raw });
    if (typeof raw === 'object' && raw && typeof raw.T === 'number') {
      this.latency.record(channel, 'tickAge', ts - raw.T);
    }
    const pair: string | undefined = raw?.s ?? raw?.pair;
    if (pair) this.stale.touch(channel, pair);

    if (channel === 'depth-snapshot' && pair) {
      this.books.onDepthSnapshot(pair, {
        asks: raw.asks ?? [],
        bids: raw.bids ?? [],
        ts,
      });
    } else if (channel === 'depth-update' && pair) {
      this.books.onDepthDelta(pair, {
        asks: raw.asks ?? [],
        bids: raw.bids ?? [],
        ts,
      });
    }
  }

  start(): void {
    this.heartbeat.start();
    this.staleTimer = setInterval(() => this.stale.tick(), 1000);
    this.timeSyncTimer = setInterval(
      () => { void this.timeSync.checkOnce(); },
      this.deps.config.TIME_SYNC_INTERVAL_MS,
    );
    this.latencyTimer = setInterval(() => {
      const channels = ['depth-update', 'new-trade', 'currentPrices@futures#update', 'ws'];
      for (const ch of channels) {
        const wsRtt = this.latency.snapshot(ch, 'wsRtt');
        const tickAge = this.latency.snapshot(ch, 'tickAge');
        this.deps.logger.info({ mod: 'latency', channel: ch, wsRtt, tickAge }, 'latency snapshot');
      }
    }, 60_000);
    void this.timeSync.checkOnce();
  }

  stop(): void {
    this.heartbeat.stop();
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.timeSyncTimer) clearInterval(this.timeSyncTimer);
    if (this.latencyTimer) clearInterval(this.latencyTimer);
  }

  wsLatencyMs(): number {
    return this.latency.snapshot('ws', 'wsRtt').p50;
  }
}
```

- [ ] **Step 2: Wire into `src/index.ts`**

Edit `src/index.ts`:

a. Imports near top:
```ts
import { IntegrityController } from './marketdata/integrity-controller';
import ntp from 'ntp-client';
import axios from 'axios';
```

b. Inside `runApp(ctx)`, after `const ws = new CoinDCXWs();`, before existing depth handlers:

```ts
  const integrity = new IntegrityController({
    config: ctx.config,
    logger: ctx.logger.child({ mod: 'integrity' }),
    pool: ctx.pool,
    audit: ctx.audit,
    bus: ctx.bus,
    ws: ws as any,
    restFetchOrderBook: async (pair: string) => {
      const r = await axios.get('https://api.coindcx.com/exchange/v1/derivatives/data/orderbook', {
        params: { pair }, timeout: 10_000,
      });
      const data = r.data as { asks?: Record<string, string> | Array<[string,string]>; bids?: Record<string, string> | Array<[string,string]>; };
      const toArr = (v: any): Array<[string, string]> => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') return Object.entries(v).map(([p, q]) => [p, String(q)] as [string, string]);
        return [];
      };
      return { asks: toArr(data.asks), bids: toArr(data.bids), ts: Date.now() };
    },
    fetchExchangeMs: async () => {
      const r = await axios.get('https://api.coindcx.com/exchange/v1/markets', { timeout: 5000 });
      const dh = r.headers['date'];
      if (typeof dh === 'string') return Date.parse(dh);
      throw new Error('no date header');
    },
    fetchNtpMs: () => new Promise((resolve, reject) => {
      ntp.getNetworkTime('pool.ntp.org', 123, (err: any, date: Date | null) => {
        if (err || !date) return reject(err ?? new Error('ntp failed'));
        resolve(date.getTime());
      });
    }),
  });
  integrity.start();
```

c. Replace the existing `ws.on('depth-snapshot', ...)` and `ws.on('depth-update', ...)` blocks with:

```ts
  ws.on('depth-snapshot', (raw: any) => integrity.ingest('depth-snapshot', raw));
  ws.on('depth-update',   (raw: any) => integrity.ingest('depth-update',   raw));
  ws.on('new-trade',      (raw: any) => integrity.ingest('new-trade',      raw));
  ws.on('currentPrices@futures#update', (raw: any) => integrity.ingest('currentPrices@futures#update', raw));
  ws.on('currentPrices@spot#update',    (raw: any) => integrity.ingest('currentPrices@spot#update',    raw));
```

(Existing TUI-driving handlers can stay; integrity ingestion is in addition. If duplicate handlers cause issues, route TUI updates from integrity events instead.)

- [ ] **Step 3: Write controller integration test**

Create `tests/marketdata/integrity-controller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { IntegrityController } from '../../src/marketdata/integrity-controller';

class FakeWs extends EventEmitter {
  reconnect = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
}

function makeDeps(overrides: Partial<any> = {}) {
  const ws = new FakeWs();
  const audit = { recordEvent: vi.fn() };
  const bus = { emit: vi.fn(async () => {}) };
  const logger: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => logger,
  };
  return {
    config: {
      LOG_DIR: '/tmp',
      TAIL_BUFFER_SIZE: 10, LATENCY_RESERVOIR: 64, STALE_RESERVOIR: 16,
      STALE_FLOOR_depthUpdate: 1000, STALE_FLOOR_newTrade: 2000,
      STALE_FLOOR_currentPrices: 1000,
      HEARTBEAT_INTERVAL_MS: 100_000, HEARTBEAT_TIMEOUT_MS: 100_000,
      TIME_SYNC_INTERVAL_MS: 100_000, SKEW_THRESHOLD_MS: 100,
      RESYNC_WS_TIMEOUT_MS: 50,
      REST_BUDGET_GLOBAL_PER_MIN: 100, REST_BUDGET_PAIR_PER_MIN: 100,
      REST_BUDGET_TIMEOUT_MS: 100,
    } as any,
    logger,
    pool: {} as any,
    audit: audit as any,
    bus: bus as any,
    ws: ws as any,
    restFetchOrderBook: vi.fn(async () => ({ asks: [['10','1']] as any, bids: [['9','1']] as any, ts: Date.now() })),
    fetchExchangeMs: async () => Date.now(),
    fetchNtpMs: async () => Date.now(),
    ...overrides,
  };
}

describe('IntegrityController', () => {
  it('gap injection triggers REST resync and emits book_resync signal', async () => {
    const deps = makeDeps();
    const ic = new IntegrityController(deps as any);
    ic.ingest('depth-snapshot', { s: 'B-X_USDT', asks: [['1','1']], bids: [['0.5','1']] });
    ic.ingest('depth-update',   { s: 'B-X_USDT', asks: [['9','0']], bids: [] }); // gap
    await new Promise((r) => setTimeout(r, 100));
    expect(deps.restFetchOrderBook).toHaveBeenCalledWith('B-X_USDT');
    const types = (deps.bus.emit as any).mock.calls.map((c: any[]) => c[0].type);
    expect(types).toContain('book_resync');
  });
});
```

- [ ] **Step 4: Run controller test, expect pass**

Run: `npx vitest run tests/marketdata/integrity-controller.test.ts`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/integrity-controller.ts src/index.ts tests/marketdata/integrity-controller.test.ts
git commit -m "feat(f2): IntegrityController wires book + health + resync into runApp"
```

---

## Task 13: TUI badge — real `LAT` from latency tracker

**Files:**
- Modify: `src/tui/app.ts`
- Modify: `src/index.ts` (push wsLatencyMs into TUI periodically)

- [ ] **Step 1: Make TUI accept book state for focused pair**

Add to `src/tui/app.ts` `updateStatus` already accepts `latency`. Add new `updateBookState(state: string)` method:

```ts
  private bookStateText: string = '—';

  updateBookState(s: string): void {
    this.bookStateText = s;
    this.statusBar.setContent(this.buildStatusContent());
    this.render();
  }
```

Update `buildStatusContent` to include `BOOK: ${this.bookStateText}` (right after `FEED:`).

- [ ] **Step 2: Drive TUI from controller in `src/index.ts`**

After `integrity.start();`, add:

```ts
  setInterval(() => {
    tui.updateStatus({ latency: integrity.wsLatencyMs() });
    const focused = tui.focusedPair;
    const book = integrity.books.get(focused);
    tui.updateBookState(book ? book.state() : '—');
  }, 1000);
```

- [ ] **Step 3: Run full check, expect green**

Run: `npm run check`
Expected: typecheck + lint + tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tui/app.ts src/index.ts
git commit -m "feat(f2): TUI shows real ws RTT and per-pair book state"
```

---

## Task 14: Probe replay integration test

**Files:**
- Create: `tests/marketdata/probe-replay.test.ts`
- Create: `tests/fixtures/probe-sample.jsonl` — small hand-written sample

- [ ] **Step 1: Hand-author `tests/fixtures/probe-sample.jsonl`**

```
{"ts":1,"channel":"depth-snapshot","raw":{"s":"B-X_USDT","asks":[["10","1"],["11","2"]],"bids":[["9","1"],["8","2"]]}}
{"ts":2,"channel":"depth-update","raw":{"s":"B-X_USDT","asks":[["10","3"]],"bids":[]}}
{"ts":3,"channel":"depth-update","raw":{"s":"B-X_USDT","asks":[["99","0"]],"bids":[]}}
{"ts":4,"channel":"new-trade","raw":{"s":"B-X_USDT","p":"10","q":"1","T":4}}
```

- [ ] **Step 2: Write replay test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { IntegrityController } from '../../src/marketdata/integrity-controller';

class FakeWs extends EventEmitter {
  reconnect = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
}

describe('probe replay', () => {
  it('feeds recorded frames through controller and recovers from injected gap', async () => {
    const fixture = readFileSync(join(__dirname, '../fixtures/probe-sample.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    const ws = new FakeWs();
    const audit = { recordEvent: vi.fn() };
    const bus = { emit: vi.fn(async () => {}) };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
    const ic = new IntegrityController({
      config: {
        LOG_DIR: '/tmp', TAIL_BUFFER_SIZE: 10, LATENCY_RESERVOIR: 64, STALE_RESERVOIR: 16,
        STALE_FLOOR_depthUpdate: 1000, STALE_FLOOR_newTrade: 2000, STALE_FLOOR_currentPrices: 1000,
        HEARTBEAT_INTERVAL_MS: 100_000, HEARTBEAT_TIMEOUT_MS: 100_000,
        TIME_SYNC_INTERVAL_MS: 100_000, SKEW_THRESHOLD_MS: 100,
        RESYNC_WS_TIMEOUT_MS: 30,
        REST_BUDGET_GLOBAL_PER_MIN: 100, REST_BUDGET_PAIR_PER_MIN: 100, REST_BUDGET_TIMEOUT_MS: 100,
      } as any,
      logger, pool: {} as any, audit: audit as any, bus: bus as any, ws: ws as any,
      restFetchOrderBook: vi.fn(async () => ({ asks: [['10','1']] as any, bids: [['9','1']] as any, ts: Date.now() })),
      fetchExchangeMs: async () => Date.now(),
      fetchNtpMs: async () => Date.now(),
    });

    for (const f of fixture) ic.ingest(f.channel, f.raw);
    await new Promise((r) => setTimeout(r, 80));

    expect(ic.books.get('B-X_USDT')!.state()).toBe('live');
    const types = (bus.emit as any).mock.calls.map((c: any[]) => c[0].type);
    expect(types).toContain('book_resync');
  });
});
```

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run tests/marketdata/probe-replay.test.ts`
Expected: 1 PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/marketdata/probe-replay.test.ts tests/fixtures/probe-sample.jsonl
git commit -m "test(f2): probe replay integration covers gap → resync recovery"
```

---

## Task 15: README + roadmap

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add F2 section**

Replace the "Phase 1 (current)" header block with:

```markdown
## Phases

### Phase 1: Reliability foundation (shipped)
- Validated config (zod), pino logging, Postgres persistence
- Pluggable signal sinks (stdout / JSONL / Telegram)
- ReadOnlyGuard with signed-read POST allowlist

### Phase 2: Market data integrity (current)
- L2 OrderBook with checksum + state machine
- BookManager + ResyncOrchestrator (WS-first, REST fallback under token-bucket)
- Heartbeat watchdog, StaleWatcher, latency histograms (ws-rtt + tick-age)
- Time-sync (exchange + NTP)
- Always-on TailBuffer + `npm run probe -- --pair X --duration N` for raw frame capture
```

- [ ] **Step 2: Run full check**

Run: `npm run check`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(f2): update README phase status"
```

---

## Self-review

- **Spec coverage:**
  - L2 book + checksum (Tasks 5, 6)
  - Heuristic gap detection (Task 5 logical anomaly + Task 12 controller wiring; checksum-vs-REST sampling deferred — Task 6/12 emit checksum on demand; full sampler is in Task 12 latency timer if extended; **Note:** explicit periodic checksum-vs-REST sampler not implemented in plan; it's a follow-up issue logged in spec under Gap Detection #1. Acceptance criteria are met by logical-anomaly path which is the more frequent trigger.)
  - WS-first + REST fallback resync (Task 7)
  - RestBudget (Task 4)
  - Heartbeat (Task 8)
  - StaleWatcher hybrid threshold (Task 10)
  - LatencyTracker dual histograms (Task 9)
  - TimeSync exchange + NTP (Task 11)
  - TailBuffer + auto-dump (Task 2 + Task 12 wires `dump()` on gap)
  - Probe CLI (Task 3)
  - IntegrityController wiring (Task 12)
  - TUI real LAT badge (Task 13)
  - Probe replay test (Task 14)

- **Placeholder scan:** none. Every step has either runnable code or a concrete command.
- **Type consistency:** `BookManager` used in 6, 7, 12; `RestBudget`, `ResyncOrchestrator`, `IntegrityController` consistent across tasks. `DepthFrame` defined in Task 6, used in Task 7 + 12.
- **Carve-out documented:** the periodic checksum-vs-REST audit (spec §"Gap Detection" #1) is intentionally deferred — current plan covers logical anomaly + delete-unknown-level + delta-before-snapshot triggers, which are the high-frequency cases. Add as Task 16 in a follow-up if needed.
