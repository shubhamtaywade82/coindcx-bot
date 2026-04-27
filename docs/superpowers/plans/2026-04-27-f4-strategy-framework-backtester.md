# F4 — Strategy Framework + Backtester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace monolithic `AiAnalyzer` with a pluggable strategy framework (registry + per-strategy cadence drivers + RiskFilter passthrough) emitting richer signals on F1 SignalBus, plus a deterministic backtester that replays historical data through the same Strategy contract and produces standard performance metrics + per-trade CSV.

**Architecture:** Per-component split mirroring F2/F3. `Strategy` interface with declared `mode` (`interval`/`tick`/`bar_close`); `StrategyRegistry` instantiates one instance per pair when a strategy targets multiple pairs; per-mode drivers schedule evaluation; `ContextBuilder` composes `MarketState` + `AccountSnapshot` per call; `RiskFilter` passthrough boundary stubs F5; `Backtester` reuses Strategy contract via `DataSource` iterators (REST candles, Postgres fills, JSONL probe) and `Simulator` that produces a per-trade ledger and metrics.

**Tech Stack:** TypeScript, zod, axios, pg, vitest, blessed (existing TUI), F1 SignalBus + ReadOnlyGuard, F2 WsManager + MarketStateBuilder, F3 AccountReconcileController, existing Ollama-backed AiAnalyzer.

**Reference:** `docs/superpowers/specs/2026-04-27-f4-strategy-framework-backtester-design.md`

---

## File Structure

**New:**
- `src/strategy/types.ts` — Strategy, StrategyContext, StrategySignal, RiskFilter, Manifest, Mode, Side
- `src/strategy/risk/risk-filter.ts` — RiskFilter interface + PassthroughRiskFilter
- `src/strategy/registry.ts` — StrategyRegistry (per-pair instance isolation, perf counters)
- `src/strategy/context-builder.ts` — composes StrategyContext for live mode
- `src/strategy/scheduler/interval-driver.ts`
- `src/strategy/scheduler/tick-driver.ts`
- `src/strategy/scheduler/bar-driver.ts`
- `src/strategy/strategies/smc-rule.ts`
- `src/strategy/strategies/ma-cross.ts`
- `src/strategy/strategies/llm-pulse.ts`
- `src/strategy/controller.ts`
- `src/strategy/backtest/types.ts`
- `src/strategy/backtest/data-source.ts` (factory + interfaces)
- `src/strategy/backtest/sources/candle-source.ts`
- `src/strategy/backtest/sources/postgres-fill-source.ts`
- `src/strategy/backtest/sources/jsonl-source.ts`
- `src/strategy/backtest/simulator.ts`
- `src/strategy/backtest/metrics.ts`
- `src/strategy/backtest/trade-ledger.ts`
- `src/strategy/backtest/runner.ts`
- `src/cli/backtest.ts`
- All matching `tests/strategy/...`

**Modified:**
- `src/ai/state-builder.ts` — promote `MarketState` to a named exported type
- `src/config/schema.ts` — add F4 env vars
- `src/index.ts` — replace direct `AiAnalyzer` usage with `StrategyController`
- `package.json` — `backtest` script
- `README.md` — phase status

---

## Task 1: Promote `MarketState` named export from state-builder

**Files:**
- Modify: `src/ai/state-builder.ts`

- [ ] **Step 1: Write failing test**

Create `tests/ai/state-builder-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { MarketState, MarketStateConfluence } from '../../src/ai/state-builder';

describe('MarketState type export', () => {
  it('compiles when MarketState is consumed at type level', () => {
    const m: MarketState = {
      htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
      ltf: {
        trend: 'uptrend', bos: false, swing_high: 1, swing_low: 0,
        displacement: { present: false, strength: 'weak' },
        fvg: [], mitigation: { status: 'untouched', zone: [0, 0] }, inducement: { present: false },
        premium_discount: 'equilibrium',
      },
      confluence: { aligned: true, narrative: 'x' },
      liquidity: { pools: [], event: 'none' },
      state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
    };
    expect(m.htf.trend).toBe('uptrend');
    const c: MarketStateConfluence = m.confluence;
    expect(c.aligned).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/ai/state-builder-types.test.ts`
Expected: FAIL — `MarketState` not exported.

- [ ] **Step 3: Add named exports**

In `src/ai/state-builder.ts`, replace `build(...) : any {` signature and add types above the class:

```ts
export interface MarketStateHtf {
  trend: string;
  swing_high: number;
  swing_low: number;
}

export interface MarketStateLtf {
  trend: string;
  bos: boolean;
  swing_high: number;
  swing_low: number;
  displacement: { present: boolean; strength: 'weak' | 'strong' };
  fvg: Array<{ type: 'bullish' | 'bearish'; gap: [number, number]; filled: boolean }>;
  mitigation: { status: string; zone: [number, number] };
  inducement: { present: boolean };
  premium_discount: 'premium' | 'discount' | 'equilibrium';
}

export interface MarketStateConfluence {
  aligned: boolean;
  narrative: string;
}

export interface MarketStateLiquidity {
  pools: unknown[];
  event: string;
}

export interface MarketStateFlags {
  is_trending: boolean;
  is_post_sweep: boolean;
  is_pre_expansion: boolean;
}

export interface MarketState {
  htf: MarketStateHtf;
  ltf: MarketStateLtf;
  confluence: MarketStateConfluence;
  liquidity: MarketStateLiquidity;
  state: MarketStateFlags;
}
```

Then change the class method:

```ts
build(htfCandles: Candle[], ltfCandles: Candle[], _orderBook: unknown, _positions: unknown[]): MarketState | null {
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/ai/state-builder-types.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ai/state-builder.ts tests/ai/state-builder-types.test.ts
git commit -m "refactor(f4): promote MarketState to named export"
```

---

## Task 2: F4 config vars

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `tests/config/schema.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/config/schema.test.ts`:

```ts
describe('F4 strategy config defaults', () => {
  it('parses with F4 defaults', () => {
    const cfg = ConfigSchema.parse(validEnv);
    expect(cfg.STRATEGY_TIMEOUT_MS).toBe(5000);
    expect(cfg.STRATEGY_ERROR_THRESHOLD).toBe(3);
    expect(cfg.STRATEGY_EMIT_WAIT).toBe(false);
    expect(cfg.STRATEGY_INTERVAL_DEFAULT_MS).toBe(15000);
    expect(cfg.STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM).toBe(0.5);
    expect(cfg.BACKTEST_PESSIMISTIC).toBe(true);
    expect(cfg.STRATEGY_ENABLED_IDS).toEqual(['smc.rule.v1','ma.cross.v1','llm.pulse.v1']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: FAIL — undefined.

- [ ] **Step 3: Add to schema**

In `src/config/schema.ts`, inside the `z.object({ ... })` block before the F3 vars closing:

```ts
  // F4 Strategy Framework
  STRATEGY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  STRATEGY_ERROR_THRESHOLD: z.coerce.number().int().positive().default(3),
  STRATEGY_EMIT_WAIT: z.string().default('false').transform(s => s === 'true'),
  STRATEGY_INTERVAL_DEFAULT_MS: z.coerce.number().int().positive().default(15000),
  STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM: z.coerce.number().default(0.5),
  STRATEGY_ENABLED_IDS: z.string().default('smc.rule.v1,ma.cross.v1,llm.pulse.v1')
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  BACKTEST_PESSIMISTIC: z.string().default('true').transform(s => s !== 'false'),
  BACKTEST_OUTPUT_DIR: z.string().default('./logs/backtest'),
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(f4): add strategy framework config vars"
```

---

## Task 3: Strategy types module

**Files:**
- Create: `src/strategy/types.ts`

- [ ] **Step 1: Write the file**

Create `src/strategy/types.ts`:

```ts
import type { MarketState, Candle } from '../ai/state-builder';
import type { AccountSnapshot, Fill } from '../account/types';

export type StrategyMode = 'interval' | 'tick' | 'bar_close';
export type Side = 'LONG' | 'SHORT' | 'WAIT';
export type TickChannel = 'depth-update' | 'new-trade' | 'currentPrices@futures#update';

export interface StrategyManifest {
  id: string;
  version: string;
  mode: StrategyMode;
  intervalMs?: number;
  barTimeframes?: string[];
  tickChannels?: TickChannel[];
  pairs: string[];
  warmupCandles?: number;
  description: string;
}

export type StrategyTrigger =
  | { kind: 'interval' }
  | { kind: 'tick'; channel: TickChannel; raw: unknown }
  | { kind: 'bar_close'; tf: string };

export interface StrategyContext {
  ts: number;
  pair: string;
  marketState: MarketState;
  account: AccountSnapshot;
  recentFills: Fill[];
  trigger: StrategyTrigger;
}

export interface StrategySignal {
  side: Side;
  confidence: number;
  entry?: string;
  stopLoss?: string;
  takeProfit?: string;
  reason: string;
  noTradeCondition?: string;
  ttlMs?: number;
  meta?: Record<string, unknown>;
}

export interface Strategy {
  manifest: StrategyManifest;
  warmup?(ctx: { pair: string; candles: Candle[] }): Promise<void> | void;
  evaluate(ctx: StrategyContext): Promise<StrategySignal | null> | StrategySignal | null;
  clone?(): Strategy;
}

export interface RiskFilter {
  filter(signal: StrategySignal, manifest: StrategyManifest, account: AccountSnapshot): StrategySignal | null;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/strategy/types.ts
git commit -m "feat(f4): add strategy framework types"
```

---

## Task 4: PassthroughRiskFilter

**Files:**
- Create: `src/strategy/risk/risk-filter.ts`
- Create: `tests/strategy/risk/passthrough.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/risk/passthrough.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PassthroughRiskFilter } from '../../../src/strategy/risk/risk-filter';
import type { StrategyManifest, StrategySignal } from '../../../src/strategy/types';
import type { AccountSnapshot } from '../../../src/account/types';

const manifest: StrategyManifest = {
  id: 'x', version: '1', mode: 'interval', intervalMs: 1000,
  pairs: ['B-BTC_USDT'], description: 'x',
};
const account: AccountSnapshot = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

describe('PassthroughRiskFilter', () => {
  it('returns input unchanged for LONG', () => {
    const f = new PassthroughRiskFilter();
    const s: StrategySignal = { side: 'LONG', confidence: 0.8, reason: 'r' };
    expect(f.filter(s, manifest, account)).toEqual(s);
  });
  it('returns input unchanged for WAIT', () => {
    const f = new PassthroughRiskFilter();
    const s: StrategySignal = { side: 'WAIT', confidence: 0, reason: 'r' };
    expect(f.filter(s, manifest, account)).toEqual(s);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/risk/passthrough.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/strategy/risk/risk-filter.ts`:

```ts
import type { AccountSnapshot } from '../../account/types';
import type { RiskFilter, StrategyManifest, StrategySignal } from '../types';

export class PassthroughRiskFilter implements RiskFilter {
  filter(signal: StrategySignal, _manifest: StrategyManifest, _account: AccountSnapshot): StrategySignal | null {
    return signal;
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/risk/passthrough.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/risk/risk-filter.ts tests/strategy/risk/passthrough.test.ts
git commit -m "feat(f4): RiskFilter interface + passthrough impl"
```

---

## Task 5: StrategyRegistry

**Files:**
- Create: `src/strategy/registry.ts`
- Create: `tests/strategy/registry.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StrategyRegistry } from '../../src/strategy/registry';
import type { Strategy, StrategyManifest } from '../../src/strategy/types';

function makeStrategy(id: string, pairs: string[], cloneable = false): Strategy {
  const manifest: StrategyManifest = { id, version: '1', mode: 'interval', intervalMs: 1000, pairs, description: id };
  let instance: Strategy = {
    manifest,
    evaluate: () => null,
  };
  if (cloneable) {
    instance.clone = () => ({ manifest, evaluate: () => null });
  }
  return instance;
}

describe('StrategyRegistry', () => {
  it('registers and lists', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    expect(r.list().map(m => m.id)).toEqual(['a']);
  });

  it('rejects duplicate id', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    expect(() => r.register(makeStrategy('a', ['B-BTC_USDT']))).toThrow(/duplicate/i);
  });

  it('per-pair instances when pairs.length > 1 and clone exists', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT', 'B-ETH_USDT'], true));
    const i1 = r.instance('a', 'B-BTC_USDT');
    const i2 = r.instance('a', 'B-ETH_USDT');
    expect(i1).toBeDefined();
    expect(i2).toBeDefined();
    expect(i1).not.toBe(i2);
  });

  it('throws if multi-pair without clone', () => {
    const r = new StrategyRegistry();
    expect(() => r.register(makeStrategy('a', ['B-BTC_USDT', 'B-ETH_USDT'], false))).toThrow(/clone/i);
  });

  it('enable/disable gates evaluations', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    expect(r.enabled('a')).toBe(true);
    r.disable('a');
    expect(r.enabled('a')).toBe(false);
    r.enable('a');
    expect(r.enabled('a')).toBe(true);
  });

  it('performance counters increment', () => {
    const r = new StrategyRegistry();
    r.register(makeStrategy('a', ['B-BTC_USDT']));
    r.recordEmit('a');
    r.recordEmit('a');
    r.recordError('a');
    expect(r.performance('a')).toEqual(expect.objectContaining({
      signalsEmitted: 2, errors: 1, lastSignalAt: expect.any(Number),
    }));
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/registry.ts`:

```ts
import type { Strategy, StrategyManifest } from './types';

interface RegistryEntry {
  manifest: StrategyManifest;
  enabled: boolean;
  perInstance: Map<string, Strategy>;
  perf: { signalsEmitted: number; lastSignalAt: number; errors: number };
  errorStreak: Map<string, number>;
}

export class StrategyRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(s: Strategy): void {
    if (this.entries.has(s.manifest.id)) {
      throw new Error(`duplicate strategy id: ${s.manifest.id}`);
    }
    if (s.manifest.pairs.length > 1 && !s.clone) {
      throw new Error(`strategy ${s.manifest.id} declares multi-pair but lacks clone()`);
    }
    const perInstance = new Map<string, Strategy>();
    if (s.manifest.pairs.length > 1) {
      for (const pair of s.manifest.pairs) {
        perInstance.set(pair, s.clone!());
      }
    } else {
      perInstance.set(s.manifest.pairs[0]!, s);
    }
    this.entries.set(s.manifest.id, {
      manifest: s.manifest,
      enabled: true,
      perInstance,
      perf: { signalsEmitted: 0, lastSignalAt: 0, errors: 0 },
      errorStreak: new Map(),
    });
  }

  list(): StrategyManifest[] {
    return Array.from(this.entries.values()).map(e => e.manifest);
  }

  instance(id: string, pair: string): Strategy | undefined {
    return this.entries.get(id)?.perInstance.get(pair);
  }

  pairs(id: string): string[] {
    const e = this.entries.get(id);
    return e ? Array.from(e.perInstance.keys()) : [];
  }

  enable(id: string): void {
    const e = this.entries.get(id);
    if (e) e.enabled = true;
  }

  disable(id: string): void {
    const e = this.entries.get(id);
    if (e) e.enabled = false;
  }

  enabled(id: string): boolean {
    return !!this.entries.get(id)?.enabled;
  }

  recordEmit(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.perf.signalsEmitted++;
    e.perf.lastSignalAt = Date.now();
  }

  recordError(id: string, pair?: string): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    e.perf.errors++;
    if (pair) {
      const streak = (e.errorStreak.get(pair) ?? 0) + 1;
      e.errorStreak.set(pair, streak);
      return streak;
    }
    return 0;
  }

  resetErrorStreak(id: string, pair: string): void {
    this.entries.get(id)?.errorStreak.set(pair, 0);
  }

  performance(id: string): RegistryEntry['perf'] | undefined {
    return this.entries.get(id)?.perf;
  }

  manifest(id: string): StrategyManifest | undefined {
    return this.entries.get(id)?.manifest;
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/registry.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/registry.ts tests/strategy/registry.test.ts
git commit -m "feat(f4): StrategyRegistry with per-pair isolation and perf counters"
```

---

## Task 6: ContextBuilder (live)

**Files:**
- Create: `src/strategy/context-builder.ts`
- Create: `tests/strategy/context-builder.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/context-builder.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ContextBuilder } from '../../src/strategy/context-builder';
import type { Candle, MarketState } from '../../src/ai/state-builder';
import type { AccountSnapshot } from '../../src/account/types';

const fakeMarket: MarketState = {
  htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
  ltf: { trend: 'uptrend', bos: false, swing_high: 1, swing_low: 0,
    displacement: { present: false, strength: 'weak' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0, 0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: 'x' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};
const fakeAccount: AccountSnapshot = {
  positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' },
};

describe('ContextBuilder', () => {
  it('composes context from sources', () => {
    const buildState = vi.fn().mockReturnValue(fakeMarket);
    const fetchCandles = vi.fn().mockResolvedValue([]);
    const accountSnap = vi.fn().mockReturnValue(fakeAccount);
    const fillsRecent = vi.fn().mockReturnValue([]);
    const cb = new ContextBuilder({
      buildMarketState: buildState,
      candleProvider: { ltf: () => [] as Candle[], htf: () => [] as Candle[] },
      accountSnapshot: accountSnap,
      recentFills: fillsRecent,
      clock: () => 12345,
    });
    const ctx = cb.build({ pair: 'B-BTC_USDT', trigger: { kind: 'interval' } });
    expect(ctx.ts).toBe(12345);
    expect(ctx.pair).toBe('B-BTC_USDT');
    expect(ctx.marketState).toBe(fakeMarket);
    expect(ctx.account).toBe(fakeAccount);
    expect(ctx.trigger.kind).toBe('interval');
  });

  it('returns null when market state cannot be built', () => {
    const cb = new ContextBuilder({
      buildMarketState: () => null,
      candleProvider: { ltf: () => [] as Candle[], htf: () => [] as Candle[] },
      accountSnapshot: () => fakeAccount,
      recentFills: () => [],
      clock: () => 1,
    });
    expect(cb.build({ pair: 'X', trigger: { kind: 'interval' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/context-builder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/context-builder.ts`:

```ts
import type { Candle, MarketState } from '../ai/state-builder';
import type { AccountSnapshot, Fill } from '../account/types';
import type { StrategyContext, StrategyTrigger } from './types';

export interface CandleProvider {
  ltf: (pair: string) => Candle[];
  htf: (pair: string) => Candle[];
}

export interface ContextBuilderOptions {
  buildMarketState: (htf: Candle[], ltf: Candle[]) => MarketState | null;
  candleProvider: CandleProvider;
  accountSnapshot: () => AccountSnapshot;
  recentFills: (n?: number) => Fill[];
  clock?: () => number;
}

export class ContextBuilder {
  private clock: () => number;

  constructor(private opts: ContextBuilderOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  build(args: { pair: string; trigger: StrategyTrigger }): StrategyContext | null {
    const ltf = this.opts.candleProvider.ltf(args.pair);
    const htf = this.opts.candleProvider.htf(args.pair);
    const marketState = this.opts.buildMarketState(htf, ltf);
    if (!marketState) return null;
    return {
      ts: this.clock(),
      pair: args.pair,
      marketState,
      account: this.opts.accountSnapshot(),
      recentFills: this.opts.recentFills(20),
      trigger: args.trigger,
    };
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/context-builder.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/context-builder.ts tests/strategy/context-builder.test.ts
git commit -m "feat(f4): ContextBuilder for live strategy evaluation"
```

---

## Task 7: IntervalDriver

**Files:**
- Create: `src/strategy/scheduler/interval-driver.ts`
- Create: `tests/strategy/scheduler/interval-driver.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/scheduler/interval-driver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { IntervalDriver } from '../../../src/strategy/scheduler/interval-driver';

describe('IntervalDriver', () => {
  it('calls runEvaluation per pair on interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new IntervalDriver({ runEvaluation: run });
    d.add({ id: 'a', pairs: ['p1', 'p2'], intervalMs: 1000 });
    d.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledWith('a', 'p1', { kind: 'interval' });
    expect(run).toHaveBeenCalledWith('a', 'p2', { kind: 'interval' });
    d.stop();
    vi.useRealTimers();
  });

  it('skips pair when previous evaluation still pending', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const d = new IntervalDriver({ runEvaluation: run });
    d.add({ id: 'a', pairs: ['p1'], intervalMs: 100 });
    d.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    d.stop();
    vi.useRealTimers();
  });

  it('stop halts further evaluations', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new IntervalDriver({ runEvaluation: run });
    d.add({ id: 'a', pairs: ['p1'], intervalMs: 100 });
    d.start();
    await vi.advanceTimersByTimeAsync(100);
    d.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/scheduler/interval-driver.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/scheduler/interval-driver.ts`:

```ts
import type { StrategyTrigger } from '../types';

export interface IntervalDriverOptions {
  runEvaluation: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void>;
}

interface Entry {
  id: string;
  pairs: string[];
  intervalMs: number;
  pending: Set<string>;
  timer: NodeJS.Timeout | null;
}

export class IntervalDriver {
  private entries = new Map<string, Entry>();

  constructor(private opts: IntervalDriverOptions) {}

  add(args: { id: string; pairs: string[]; intervalMs: number }): void {
    this.entries.set(args.id, { id: args.id, pairs: [...args.pairs], intervalMs: args.intervalMs, pending: new Set(), timer: null });
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (e?.timer) clearInterval(e.timer);
    this.entries.delete(id);
  }

  start(): void {
    for (const e of this.entries.values()) {
      if (e.timer) continue;
      e.timer = setInterval(() => { void this.fire(e); }, e.intervalMs);
    }
  }

  stop(): void {
    for (const e of this.entries.values()) {
      if (e.timer) clearInterval(e.timer);
      e.timer = null;
    }
  }

  private async fire(e: Entry): Promise<void> {
    for (const pair of e.pairs) {
      if (e.pending.has(pair)) continue;
      e.pending.add(pair);
      this.opts.runEvaluation(e.id, pair, { kind: 'interval' }).finally(() => {
        e.pending.delete(pair);
      });
    }
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/scheduler/interval-driver.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/scheduler/interval-driver.ts tests/strategy/scheduler/interval-driver.test.ts
git commit -m "feat(f4): IntervalDriver with per-pair backpressure"
```

---

## Task 8: TickDriver

**Files:**
- Create: `src/strategy/scheduler/tick-driver.ts`
- Create: `tests/strategy/scheduler/tick-driver.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/scheduler/tick-driver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { TickDriver } from '../../../src/strategy/scheduler/tick-driver';

describe('TickDriver', () => {
  it('routes ws events to matching strategies', async () => {
    const ws = new EventEmitter();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new TickDriver({ ws: ws as any, runEvaluation: run, extractPair: (raw: any) => raw.pair });
    d.add({ id: 'a', pairs: ['B-BTC_USDT'], channels: ['new-trade'] });
    d.start();
    ws.emit('new-trade', { pair: 'B-BTC_USDT', price: 1 });
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledWith('a', 'B-BTC_USDT', expect.objectContaining({ kind: 'tick', channel: 'new-trade' }));
  });

  it('drops ticks for (strategy, pair) when previous still pending', async () => {
    const ws = new EventEmitter();
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const d = new TickDriver({ ws: ws as any, runEvaluation: run, extractPair: (raw: any) => raw.pair });
    d.add({ id: 'a', pairs: ['p'], channels: ['new-trade'] });
    d.start();
    ws.emit('new-trade', { pair: 'p' });
    ws.emit('new-trade', { pair: 'p' });
    ws.emit('new-trade', { pair: 'p' });
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.dropped('a', 'p')).toBe(2);
    resolve();
  });

  it('ignores pairs not in strategy manifest', async () => {
    const ws = new EventEmitter();
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new TickDriver({ ws: ws as any, runEvaluation: run, extractPair: (raw: any) => raw.pair });
    d.add({ id: 'a', pairs: ['B-BTC_USDT'], channels: ['new-trade'] });
    d.start();
    ws.emit('new-trade', { pair: 'B-ETH_USDT' });
    await new Promise(r => setImmediate(r));
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/scheduler/tick-driver.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/scheduler/tick-driver.ts`:

```ts
import type { EventEmitter } from 'events';
import type { StrategyTrigger, TickChannel } from '../types';

export interface TickDriverOptions {
  ws: EventEmitter;
  runEvaluation: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void>;
  extractPair: (raw: unknown) => string | undefined;
}

interface Entry {
  id: string;
  pairs: Set<string>;
  channels: TickChannel[];
  pending: Set<string>;
  drops: Map<string, number>;
  handlers: Array<{ ch: TickChannel; fn: (raw: unknown) => void }>;
}

export class TickDriver {
  private entries = new Map<string, Entry>();
  private started = false;

  constructor(private opts: TickDriverOptions) {}

  add(args: { id: string; pairs: string[]; channels: TickChannel[] }): void {
    this.entries.set(args.id, {
      id: args.id, pairs: new Set(args.pairs), channels: args.channels,
      pending: new Set(), drops: new Map(), handlers: [],
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const e of this.entries.values()) {
      for (const ch of e.channels) {
        const fn = (raw: unknown) => this.dispatch(e, ch, raw);
        this.opts.ws.on(ch, fn);
        e.handlers.push({ ch, fn });
      }
    }
  }

  stop(): void {
    for (const e of this.entries.values()) {
      for (const h of e.handlers) this.opts.ws.off(h.ch, h.fn);
      e.handlers = [];
    }
    this.started = false;
  }

  dropped(id: string, pair: string): number {
    return this.entries.get(id)?.drops.get(pair) ?? 0;
  }

  private dispatch(e: Entry, ch: TickChannel, raw: unknown): void {
    const pair = this.opts.extractPair(raw);
    if (!pair || !e.pairs.has(pair)) return;
    if (e.pending.has(pair)) {
      e.drops.set(pair, (e.drops.get(pair) ?? 0) + 1);
      return;
    }
    e.pending.add(pair);
    this.opts.runEvaluation(e.id, pair, { kind: 'tick', channel: ch, raw }).finally(() => {
      e.pending.delete(pair);
    });
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/scheduler/tick-driver.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/scheduler/tick-driver.ts tests/strategy/scheduler/tick-driver.test.ts
git commit -m "feat(f4): TickDriver with per-(strategy,pair) backpressure"
```

---

## Task 9: BarDriver

**Files:**
- Create: `src/strategy/scheduler/bar-driver.ts`
- Create: `tests/strategy/scheduler/bar-driver.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/scheduler/bar-driver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BarDriver, tfMs } from '../../../src/strategy/scheduler/bar-driver';

describe('tfMs', () => {
  it('parses standard timeframes', () => {
    expect(tfMs('1m')).toBe(60_000);
    expect(tfMs('5m')).toBe(5 * 60_000);
    expect(tfMs('15m')).toBe(15 * 60_000);
    expect(tfMs('1h')).toBe(60 * 60_000);
  });
});

describe('BarDriver', () => {
  it('fires bar_close once per crossed boundary', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const d = new BarDriver({ runEvaluation: run });
    d.add({ id: 's', pairs: ['p'], timeframes: ['1m'] });
    // bucket 0 starts at ts 0, boundary at 60_000
    d.tradeAt('p', 30_000);  // inside bucket 0
    expect(run).not.toHaveBeenCalled();
    d.tradeAt('p', 60_500);  // crossed boundary
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledWith('s', 'p', { kind: 'bar_close', tf: '1m' });
    d.tradeAt('p', 70_000);  // same bucket as last
    await new Promise(r => setImmediate(r));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/scheduler/bar-driver.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/scheduler/bar-driver.ts`:

```ts
import type { StrategyTrigger } from '../types';

export function tfMs(tf: string): number {
  const m = /^(\d+)([mh])$/.exec(tf);
  if (!m) throw new Error(`unsupported tf: ${tf}`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 60 * 60_000 : n * 60_000;
}

export interface BarDriverOptions {
  runEvaluation: (id: string, pair: string, trigger: StrategyTrigger) => Promise<void>;
}

interface Entry {
  id: string;
  pairs: Set<string>;
  timeframes: string[];
  lastBucket: Map<string, number>;
}

export class BarDriver {
  private entries = new Map<string, Entry>();

  constructor(private opts: BarDriverOptions) {}

  add(args: { id: string; pairs: string[]; timeframes: string[] }): void {
    this.entries.set(args.id, {
      id: args.id, pairs: new Set(args.pairs),
      timeframes: args.timeframes, lastBucket: new Map(),
    });
  }

  tradeAt(pair: string, ts: number): void {
    for (const e of this.entries.values()) {
      if (!e.pairs.has(pair)) continue;
      for (const tf of e.timeframes) {
        const bucket = Math.floor(ts / tfMs(tf));
        const key = `${pair}|${tf}`;
        const last = e.lastBucket.get(key);
        if (last === undefined) {
          e.lastBucket.set(key, bucket);
          continue;
        }
        if (bucket > last) {
          e.lastBucket.set(key, bucket);
          void this.opts.runEvaluation(e.id, pair, { kind: 'bar_close', tf });
        }
      }
    }
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/scheduler/bar-driver.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/scheduler/bar-driver.ts tests/strategy/scheduler/bar-driver.test.ts
git commit -m "feat(f4): BarDriver with per-pair-tf bucket boundary detection"
```

---

## Task 10: SmcRule strategy

**Files:**
- Create: `src/strategy/strategies/smc-rule.ts`
- Create: `tests/strategy/strategies/smc-rule.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/strategies/smc-rule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SmcRule } from '../../../src/strategy/strategies/smc-rule';
import type { StrategyContext } from '../../../src/strategy/types';
import type { MarketState } from '../../../src/ai/state-builder';
import type { AccountSnapshot } from '../../../src/account/types';

const account: AccountSnapshot = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

function ctx(market: MarketState): StrategyContext {
  return {
    ts: 1, pair: 'B-BTC_USDT', marketState: market,
    account, recentFills: [], trigger: { kind: 'interval' },
  };
}

const baseUp: MarketState = {
  htf: { trend: 'uptrend', swing_high: 50000, swing_low: 48000 },
  ltf: { trend: 'uptrend', bos: true, swing_high: 50500, swing_low: 49500,
    displacement: { present: true, strength: 'strong' },
    fvg: [{ type: 'bullish', gap: [49800, 49900], filled: false }],
    mitigation: { status: 'untouched', zone: [0, 0] }, inducement: { present: false },
    premium_discount: 'discount' },
  confluence: { aligned: true, narrative: 'aligned uptrend' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: true },
};

describe('SmcRule', () => {
  it('returns LONG on aligned uptrend with BOS + displacement + bullish FVG', async () => {
    const s = new SmcRule();
    const r = await s.evaluate(ctx(baseUp));
    expect(r?.side).toBe('LONG');
    expect(r?.confidence).toBeGreaterThan(0.5);
    expect(r?.entry).toBeDefined();
  });

  it('returns SHORT on aligned downtrend mirror conditions', async () => {
    const s = new SmcRule();
    const downtrend: MarketState = {
      ...baseUp,
      htf: { trend: 'downtrend', swing_high: 50000, swing_low: 48000 },
      ltf: { ...baseUp.ltf, trend: 'downtrend',
        fvg: [{ type: 'bearish', gap: [49900, 50000], filled: false }],
        premium_discount: 'premium' },
      confluence: { aligned: true, narrative: 'aligned downtrend' },
    };
    const r = await s.evaluate(ctx(downtrend));
    expect(r?.side).toBe('SHORT');
  });

  it('returns WAIT when HTF and LTF disagree', async () => {
    const s = new SmcRule();
    const conflict: MarketState = {
      ...baseUp,
      htf: { trend: 'downtrend', swing_high: 50000, swing_low: 48000 },
      confluence: { aligned: false, narrative: 'conflict' },
    };
    const r = await s.evaluate(ctx(conflict));
    expect(r?.side).toBe('WAIT');
    expect(r?.noTradeCondition).toMatch(/confluence/i);
  });

  it('returns WAIT without displacement', async () => {
    const s = new SmcRule();
    const noDisp: MarketState = {
      ...baseUp,
      ltf: { ...baseUp.ltf, displacement: { present: false, strength: 'weak' } },
    };
    const r = await s.evaluate(ctx(noDisp));
    expect(r?.side).toBe('WAIT');
  });

  it('manifest declares interval mode and 50 warmup candles', () => {
    const s = new SmcRule();
    expect(s.manifest.id).toBe('smc.rule.v1');
    expect(s.manifest.mode).toBe('interval');
    expect(s.manifest.warmupCandles).toBe(50);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/strategies/smc-rule.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/strategies/smc-rule.ts`:

```ts
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

const MANIFEST: StrategyManifest = {
  id: 'smc.rule.v1', version: '1.0.0', mode: 'interval', intervalMs: 15000,
  pairs: ['*'], warmupCandles: 50,
  description: 'Deterministic SMC rule: aligned HTF/LTF + BOS + displacement + matching FVG',
};

export class SmcRule implements Strategy {
  manifest = MANIFEST;

  clone(): Strategy { return new SmcRule(); }

  evaluate(ctx: StrategyContext): StrategySignal {
    const { htf, ltf, confluence } = ctx.marketState;
    if (!confluence.aligned) {
      return { side: 'WAIT', confidence: 0, reason: 'HTF/LTF not aligned',
        noTradeCondition: 'confluence missing' };
    }
    if (!ltf.displacement.present) {
      return { side: 'WAIT', confidence: 0, reason: 'no displacement',
        noTradeCondition: 'no displacement' };
    }
    if (!ltf.bos) {
      return { side: 'WAIT', confidence: 0, reason: 'no BOS',
        noTradeCondition: 'no break of structure' };
    }
    const isUp = htf.trend === 'uptrend';
    const isDown = htf.trend === 'downtrend';
    if (!isUp && !isDown) {
      return { side: 'WAIT', confidence: 0, reason: 'HTF range', noTradeCondition: 'no HTF trend' };
    }
    const wantFvg = isUp ? 'bullish' : 'bearish';
    const fvg = ltf.fvg.find(f => f.type === wantFvg && !f.filled);
    if (!fvg) {
      return { side: 'WAIT', confidence: 0.2, reason: `no ${wantFvg} FVG`,
        noTradeCondition: 'awaiting FVG entry' };
    }
    const entry = ((fvg.gap[0] + fvg.gap[1]) / 2).toString();
    const sl = (isUp ? ltf.swing_low : ltf.swing_high).toString();
    const range = Math.abs(ltf.swing_high - ltf.swing_low);
    const tp = (isUp ? ltf.swing_high + range : ltf.swing_low - range).toString();
    const strength = ltf.displacement.strength === 'strong' ? 0.85 : 0.65;
    return {
      side: isUp ? 'LONG' : 'SHORT',
      confidence: strength,
      entry, stopLoss: sl, takeProfit: tp,
      reason: `aligned ${htf.trend} + BOS + ${ltf.displacement.strength} displacement + ${wantFvg} FVG`,
      ttlMs: 5 * 60_000,
      meta: { fvg, premium_discount: ltf.premium_discount },
    };
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/strategies/smc-rule.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategies/smc-rule.ts tests/strategy/strategies/smc-rule.test.ts
git commit -m "feat(f4): SmcRule deterministic strategy"
```

---

## Task 11: MaCross strategy

**Files:**
- Create: `src/strategy/strategies/ma-cross.ts`
- Create: `tests/strategy/strategies/ma-cross.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/strategies/ma-cross.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MaCross } from '../../../src/strategy/strategies/ma-cross';
import type { StrategyContext } from '../../../src/strategy/types';
import type { Candle } from '../../../src/ai/state-builder';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ timestamp: i * 60_000, open: c, high: c, low: c, close: c, volume: 1 }));
}

const account = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

const fakeMarket = (lastClose: number) => ({
  htf: { trend: 'uptrend', swing_high: lastClose * 1.05, swing_low: lastClose * 0.95 },
  ltf: { trend: 'uptrend', bos: false, swing_high: lastClose * 1.02, swing_low: lastClose * 0.98,
    displacement: { present: false, strength: 'weak' as const }, fvg: [],
    mitigation: { status: 'untouched', zone: [0, 0] as [number, number] }, inducement: { present: false },
    premium_discount: 'equilibrium' as const },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
});

describe('MaCross', () => {
  it('emits LONG on golden cross', async () => {
    const s = new MaCross();
    await s.warmup({ pair: 'p', candles: makeCandles([
      ...Array(20).fill(100), ...Array(20).fill(95), ...Array(10).fill(110),
    ]) });
    const ctx: StrategyContext = { ts: 1, pair: 'p', marketState: fakeMarket(110) as any,
      account: account as any, recentFills: [], trigger: { kind: 'bar_close', tf: '1m' } };
    const r = await s.evaluate(ctx);
    expect(r?.side).toBe('LONG');
  });

  it('emits SHORT on death cross', async () => {
    const s = new MaCross();
    await s.warmup({ pair: 'p', candles: makeCandles([
      ...Array(20).fill(100), ...Array(20).fill(105), ...Array(10).fill(90),
    ]) });
    const ctx: StrategyContext = { ts: 1, pair: 'p', marketState: fakeMarket(90) as any,
      account: account as any, recentFills: [], trigger: { kind: 'bar_close', tf: '1m' } };
    const r = await s.evaluate(ctx);
    expect(r?.side).toBe('SHORT');
  });

  it('emits WAIT in consolidation', async () => {
    const s = new MaCross();
    await s.warmup({ pair: 'p', candles: makeCandles(Array(50).fill(100)) });
    const ctx: StrategyContext = { ts: 1, pair: 'p', marketState: fakeMarket(100) as any,
      account: account as any, recentFills: [], trigger: { kind: 'bar_close', tf: '1m' } };
    const r = await s.evaluate(ctx);
    expect(r?.side).toBe('WAIT');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/strategies/ma-cross.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/strategies/ma-cross.ts`:

```ts
import type { Candle } from '../ai/state-builder';
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

const MANIFEST: StrategyManifest = {
  id: 'ma.cross.v1', version: '1.0.0', mode: 'bar_close',
  barTimeframes: ['1m'], pairs: ['*'], warmupCandles: 50,
  description: 'Fast/slow SMA crossover (10/30) on 1m bar close',
};

const FAST = 10;
const SLOW = 30;

function sma(values: number[], n: number): number {
  if (values.length < n) return NaN;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

export class MaCross implements Strategy {
  manifest = MANIFEST;
  private closes: number[] = [];
  private prevFast = NaN;
  private prevSlow = NaN;

  clone(): Strategy { return new MaCross(); }

  warmup(ctx: { pair: string; candles: Candle[] }): void {
    this.closes = ctx.candles.map(c => c.close);
    this.prevFast = sma(this.closes, FAST);
    this.prevSlow = sma(this.closes, SLOW);
  }

  evaluate(ctx: StrategyContext): StrategySignal {
    const lastClose = ctx.marketState.htf.swing_high; // proxy; real impl pulls from candles when wired
    this.closes.push(lastClose);
    if (this.closes.length > 200) this.closes = this.closes.slice(-200);
    const fast = sma(this.closes, FAST);
    const slow = sma(this.closes, SLOW);
    const prevFast = this.prevFast;
    const prevSlow = this.prevSlow;
    this.prevFast = fast;
    this.prevSlow = slow;
    if (Number.isNaN(prevFast) || Number.isNaN(prevSlow) || Number.isNaN(fast) || Number.isNaN(slow)) {
      return { side: 'WAIT', confidence: 0, reason: 'warmup', noTradeCondition: 'insufficient data' };
    }
    if (prevFast <= prevSlow && fast > slow) {
      return { side: 'LONG', confidence: 0.6, reason: 'golden cross', entry: lastClose.toString(), ttlMs: 60_000 };
    }
    if (prevFast >= prevSlow && fast < slow) {
      return { side: 'SHORT', confidence: 0.6, reason: 'death cross', entry: lastClose.toString(), ttlMs: 60_000 };
    }
    return { side: 'WAIT', confidence: 0, reason: 'no cross', noTradeCondition: 'awaiting cross' };
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/strategies/ma-cross.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategies/ma-cross.ts tests/strategy/strategies/ma-cross.test.ts
git commit -m "feat(f4): MaCross strategy with SMA fast/slow crossover"
```

---

## Task 12: LlmPulse strategy (wraps existing AiAnalyzer)

**Files:**
- Create: `src/strategy/strategies/llm-pulse.ts`
- Create: `tests/strategy/strategies/llm-pulse.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/strategies/llm-pulse.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LlmPulse } from '../../../src/strategy/strategies/llm-pulse';

const fakeAnalyzer = (resp: any) => ({ analyze: vi.fn().mockResolvedValue(resp) }) as any;

const baseCtx: any = {
  ts: 1, pair: 'B-BTC_USDT',
  marketState: { htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 }, ltf: {}, confluence: {}, liquidity: {}, state: {} },
  account: { positions: [], balances: [], orders: [], totals: {} },
  recentFills: [], trigger: { kind: 'interval' },
};

describe('LlmPulse', () => {
  it('maps analyzer response to StrategySignal', async () => {
    const s = new LlmPulse(fakeAnalyzer({
      verdict: 'long pulse', signal: 'LONG', confidence: 0.85,
      setup: { entry: '50000', sl: '49000', tp: '52000', rr: 2 },
      no_trade_condition: undefined,
    }));
    const r = await s.evaluate(baseCtx);
    expect(r?.side).toBe('LONG');
    expect(r?.confidence).toBe(0.85);
    expect(r?.entry).toBe('50000');
    expect(r?.stopLoss).toBe('49000');
    expect(r?.takeProfit).toBe('52000');
  });

  it('returns WAIT on analyzer failure shape', async () => {
    const s = new LlmPulse(fakeAnalyzer({
      verdict: 'unavailable', signal: 'WAIT', confidence: 0,
      no_trade_condition: 'Connectivity issue',
    }));
    const r = await s.evaluate(baseCtx);
    expect(r?.side).toBe('WAIT');
    expect(r?.noTradeCondition).toBe('Connectivity issue');
  });

  it('clamps confidence to [0, 1]', async () => {
    const s = new LlmPulse(fakeAnalyzer({ signal: 'LONG', confidence: 1.7, verdict: '' }));
    const r = await s.evaluate(baseCtx);
    expect(r?.confidence).toBe(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/strategies/llm-pulse.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/strategies/llm-pulse.ts`:

```ts
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal, Side } from '../types';

interface AnalyzerLike {
  analyze: (state: unknown) => Promise<any>;
}

const MANIFEST: StrategyManifest = {
  id: 'llm.pulse.v1', version: '1.0.0', mode: 'interval', intervalMs: 15000,
  pairs: ['*'], warmupCandles: 50,
  description: 'LLM-driven SMC pulse via Ollama',
};

function clamp(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normSide(s: unknown): Side {
  const u = String(s ?? '').toUpperCase();
  if (u === 'LONG' || u === 'SHORT' || u === 'WAIT') return u;
  return 'WAIT';
}

export class LlmPulse implements Strategy {
  manifest = MANIFEST;

  constructor(private analyzer: AnalyzerLike) {}

  clone(): Strategy { return new LlmPulse(this.analyzer); }

  async evaluate(ctx: StrategyContext): Promise<StrategySignal> {
    const stateInput = { symbol: ctx.pair, ...ctx.marketState };
    const resp = await this.analyzer.analyze(stateInput);
    const side = normSide(resp?.signal);
    return {
      side,
      confidence: clamp(Number(resp?.confidence ?? 0)),
      entry: resp?.setup?.entry ? String(resp.setup.entry) : undefined,
      stopLoss: resp?.setup?.sl ? String(resp.setup.sl) : undefined,
      takeProfit: resp?.setup?.tp ? String(resp.setup.tp) : undefined,
      reason: String(resp?.verdict ?? ''),
      noTradeCondition: resp?.no_trade_condition ? String(resp.no_trade_condition) : undefined,
      ttlMs: 5 * 60_000,
      meta: { rr: resp?.setup?.rr, alternate: resp?.alternate_scenario },
    };
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/strategies/llm-pulse.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategies/llm-pulse.ts tests/strategy/strategies/llm-pulse.test.ts
git commit -m "feat(f4): LlmPulse strategy wrapping existing AiAnalyzer"
```

---

## Task 13: StrategyController

**Files:**
- Create: `src/strategy/controller.ts`
- Create: `tests/strategy/controller.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/controller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { StrategyController } from '../../src/strategy/controller';
import { PassthroughRiskFilter } from '../../src/strategy/risk/risk-filter';
import type { Strategy, StrategyManifest } from '../../src/strategy/types';

const fakeMarket: any = {
  htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
  ltf: { trend: 'uptrend', bos: true, swing_high: 1, swing_low: 0,
    displacement: { present: true, strength: 'strong' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0,0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};

const fakeAccount: any = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

function makeStrategy(id: string, pairs: string[], evalImpl: () => any): Strategy {
  const manifest: StrategyManifest = { id, version: '1', mode: 'interval', intervalMs: 100, pairs, description: '' };
  return { manifest, evaluate: evalImpl };
}

const baseDeps = () => {
  const ws = new EventEmitter();
  const bus = { emit: vi.fn().mockResolvedValue(undefined) };
  return {
    ws: ws as any,
    signalBus: bus as any,
    riskFilter: new PassthroughRiskFilter(),
    buildMarketState: () => fakeMarket,
    candleProvider: { ltf: () => [], htf: () => [] },
    accountSnapshot: () => fakeAccount,
    recentFills: () => [],
    extractPair: (raw: any) => raw?.pair,
    config: {
      timeoutMs: 1000, errorThreshold: 3, emitWait: false,
      backpressureDropRatioAlarm: 0.5,
    },
    clock: () => 1234,
  };
};

describe('StrategyController', () => {
  it('emits a signal through the pipeline', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['B-BTC_USDT'], () => ({ side: 'LONG', confidence: 0.9, reason: 'ok' })));
    await ctrl.runOnce('a', 'B-BTC_USDT', { kind: 'interval' });
    expect(deps.signalBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      strategy: 'a', type: 'strategy.long', pair: 'B-BTC_USDT',
    }));
  });

  it('does not emit WAIT by default', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['B-BTC_USDT'], () => ({ side: 'WAIT', confidence: 0, reason: 'no' })));
    await ctrl.runOnce('a', 'B-BTC_USDT', { kind: 'interval' });
    expect(deps.signalBus.emit).not.toHaveBeenCalled();
  });

  it('survives strategy throw and counts errors', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['p'], () => { throw new Error('boom'); }));
    await ctrl.runOnce('a', 'p', { kind: 'interval' });
    expect(ctrl.registry.performance('a')!.errors).toBe(1);
    expect(ctrl.registry.enabled('a')).toBe(true);
  });

  it('auto-disables after errorThreshold consecutive errors per pair', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['p'], () => { throw new Error('boom'); }));
    for (let i = 0; i < 3; i++) await ctrl.runOnce('a', 'p', { kind: 'interval' });
    expect(ctrl.registry.enabled('a')).toBe(false);
    const types = deps.signalBus.emit.mock.calls.map((c: any) => c[0].type);
    expect(types).toContain('strategy.disabled');
  });

  it('clamps confidence and rejects malformed signal', async () => {
    const deps = baseDeps();
    const ctrl = new StrategyController(deps);
    ctrl.register(makeStrategy('a', ['p'], () => ({ side: 'BOGUS', confidence: 5, reason: '' })));
    await ctrl.runOnce('a', 'p', { kind: 'interval' });
    expect(deps.signalBus.emit).not.toHaveBeenCalled();
    expect(ctrl.registry.performance('a')!.errors).toBe(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/controller.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/controller.ts`:

```ts
import type { EventEmitter } from 'events';
import type { Pool } from 'pg';
import type { SignalBus } from '../signals/bus';
import type { Signal, Severity } from '../signals/types';
import type { Candle, MarketState } from '../ai/state-builder';
import type { AccountSnapshot, Fill } from '../account/types';
import { StrategyRegistry } from './registry';
import { ContextBuilder, type CandleProvider } from './context-builder';
import { PassthroughRiskFilter } from './risk/risk-filter';
import { IntervalDriver } from './scheduler/interval-driver';
import { TickDriver } from './scheduler/tick-driver';
import { BarDriver } from './scheduler/bar-driver';
import type { RiskFilter, Strategy, StrategyManifest, StrategySignal, StrategyTrigger, Side } from './types';

const VALID_SIDES: ReadonlySet<Side> = new Set(['LONG', 'SHORT', 'WAIT']);

interface ControllerConfig {
  timeoutMs: number;
  errorThreshold: number;
  emitWait: boolean;
  backpressureDropRatioAlarm: number;
}

export interface StrategyControllerOptions {
  ws: EventEmitter;
  signalBus: Pick<SignalBus, 'emit'>;
  riskFilter?: RiskFilter;
  buildMarketState: (htf: Candle[], ltf: Candle[]) => MarketState | null;
  candleProvider: CandleProvider;
  accountSnapshot: () => AccountSnapshot;
  recentFills: (n?: number) => Fill[];
  extractPair: (raw: unknown) => string | undefined;
  config: ControllerConfig;
  clock?: () => number;
  pool?: Pool;
}

export class StrategyController {
  readonly registry = new StrategyRegistry();
  private contextBuilder: ContextBuilder;
  private riskFilter: RiskFilter;
  private intervalDriver: IntervalDriver;
  private tickDriver: TickDriver;
  private barDriver: BarDriver;
  private clock: () => number;

  constructor(private opts: StrategyControllerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.riskFilter = opts.riskFilter ?? new PassthroughRiskFilter();
    this.contextBuilder = new ContextBuilder({
      buildMarketState: opts.buildMarketState,
      candleProvider: opts.candleProvider,
      accountSnapshot: opts.accountSnapshot,
      recentFills: opts.recentFills,
      clock: this.clock,
    });
    const runner = (id: string, pair: string, trigger: StrategyTrigger) => this.runOnce(id, pair, trigger);
    this.intervalDriver = new IntervalDriver({ runEvaluation: runner });
    this.tickDriver = new TickDriver({ ws: opts.ws, runEvaluation: runner, extractPair: opts.extractPair });
    this.barDriver = new BarDriver({ runEvaluation: runner });
  }

  register(s: Strategy): void {
    this.registry.register(s);
    const m = s.manifest;
    const pairs = m.pairs.includes('*') ? this.expandStarPairs(m) : m.pairs;
    if (m.mode === 'interval') {
      this.intervalDriver.add({ id: m.id, pairs, intervalMs: m.intervalMs ?? 15000 });
    } else if (m.mode === 'tick') {
      this.tickDriver.add({ id: m.id, pairs, channels: m.tickChannels ?? ['new-trade'] });
    } else if (m.mode === 'bar_close') {
      this.barDriver.add({ id: m.id, pairs, timeframes: m.barTimeframes ?? ['1m'] });
    }
  }

  start(): void {
    this.intervalDriver.start();
    this.tickDriver.start();
  }

  stop(): void {
    this.intervalDriver.stop();
    this.tickDriver.stop();
  }

  notifyTrade(pair: string, ts: number): void {
    this.barDriver.tradeAt(pair, ts);
  }

  async runOnce(id: string, pair: string, trigger: StrategyTrigger): Promise<void> {
    if (!this.registry.enabled(id)) return;
    const strat = this.registry.instance(id, pair);
    const manifest = this.registry.manifest(id);
    if (!strat || !manifest) return;
    const ctx = this.contextBuilder.build({ pair, trigger });
    if (!ctx) return;
    let raw: StrategySignal | null;
    try {
      raw = await this.withTimeout(Promise.resolve(strat.evaluate(ctx)));
    } catch (err) {
      await this.handleError(id, pair, err as Error);
      return;
    }
    if (!raw) {
      this.registry.resetErrorStreak(id, pair);
      return;
    }
    if (!VALID_SIDES.has(raw.side as Side)) {
      await this.handleError(id, pair, new Error(`invalid side: ${raw.side}`));
      return;
    }
    raw.confidence = Math.max(0, Math.min(1, Number(raw.confidence)));
    if (Number.isNaN(raw.confidence)) {
      await this.handleError(id, pair, new Error('confidence NaN'));
      return;
    }
    this.registry.resetErrorStreak(id, pair);
    const filtered = this.riskFilter.filter(raw, manifest, ctx.account);
    if (!filtered) return;
    if (filtered.side === 'WAIT' && !this.opts.config.emitWait) return;
    await this.emit(filtered, manifest, pair);
  }

  private async emit(signal: StrategySignal, manifest: StrategyManifest, pair: string): Promise<void> {
    const ts = this.clock();
    const severity: Severity = signal.side === 'WAIT' ? 'info' : (signal.confidence > 0.7 ? 'critical' : 'warn');
    const out: Signal = {
      id: `${manifest.id}:${pair}:${ts}`,
      ts: new Date(ts).toISOString(),
      strategy: manifest.id,
      type: `strategy.${signal.side.toLowerCase()}`,
      pair,
      severity,
      payload: {
        confidence: signal.confidence, entry: signal.entry, stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit, reason: signal.reason,
        noTradeCondition: signal.noTradeCondition, ttlMs: signal.ttlMs,
        manifestVersion: manifest.version, meta: signal.meta,
      },
    };
    await this.opts.signalBus.emit(out);
    this.registry.recordEmit(manifest.id);
  }

  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('strategy timeout')), this.opts.config.timeoutMs)),
    ]);
  }

  private async handleError(id: string, pair: string, err: Error): Promise<void> {
    const streak = this.registry.recordError(id, pair);
    const ts = this.clock();
    await this.opts.signalBus.emit({
      id: `${id}:strategy.error:${ts}`,
      ts: new Date(ts).toISOString(),
      strategy: id, type: 'strategy.error', pair, severity: 'warn',
      payload: { error: err.message, streak },
    });
    if (streak >= this.opts.config.errorThreshold) {
      this.registry.disable(id);
      await this.opts.signalBus.emit({
        id: `${id}:strategy.disabled:${ts}`,
        ts: new Date(ts).toISOString(),
        strategy: id, type: 'strategy.disabled', pair, severity: 'critical',
        payload: { reason: `${streak} consecutive errors` },
      });
    }
  }

  private expandStarPairs(_m: StrategyManifest): string[] {
    return [];
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/controller.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/controller.ts tests/strategy/controller.test.ts
git commit -m "feat(f4): StrategyController with timeout, error swallowing, auto-disable"
```

---

## Task 14: Wire StrategyController into runApp

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Inspect existing AiAnalyzer wiring**

Run: `grep -n 'AiAnalyzer\|ctx.analyzer\|MarketStateBuilder\|stateBuilder' src/index.ts | head -20`

Note the call sites. The plan replaces direct `analyzer.analyze` invocations with strategy emission.

- [ ] **Step 2: Add imports**

In `src/index.ts`, near other imports:

```ts
import { StrategyController } from './strategy/controller';
import { SmcRule } from './strategy/strategies/smc-rule';
import { MaCross } from './strategy/strategies/ma-cross';
import { LlmPulse } from './strategy/strategies/llm-pulse';
import { PassthroughRiskFilter } from './strategy/risk/risk-filter';
```

- [ ] **Step 3: Construct controller after F3 account wiring**

After `account.start();` block, insert:

```ts
const candleStore = new Map<string, { ltf: Candle[]; htf: Candle[] }>();
const ensureCandles = (pair: string) => {
  if (!candleStore.has(pair)) candleStore.set(pair, { ltf: [], htf: [] });
  return candleStore.get(pair)!;
};

const strategyController = new StrategyController({
  ws,
  signalBus: ctx.bus,
  riskFilter: new PassthroughRiskFilter(),
  buildMarketState: (htf, ltf) => ctx.stateBuilder.build(htf, ltf, null, []),
  candleProvider: {
    ltf: pair => ensureCandles(pair).ltf,
    htf: pair => ensureCandles(pair).htf,
  },
  accountSnapshot: () => account.snapshot(),
  recentFills: (n = 20) => account.fills.recent(n),
  extractPair: (raw: any) => raw?.pair ?? raw?.s,
  config: {
    timeoutMs: ctx.config.STRATEGY_TIMEOUT_MS,
    errorThreshold: ctx.config.STRATEGY_ERROR_THRESHOLD,
    emitWait: ctx.config.STRATEGY_EMIT_WAIT,
    backpressureDropRatioAlarm: ctx.config.STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM,
  },
});

const enabledIds = new Set(ctx.config.STRATEGY_ENABLED_IDS);
if (enabledIds.has('smc.rule.v1')) strategyController.register(new SmcRule());
if (enabledIds.has('ma.cross.v1')) strategyController.register(new MaCross());
if (enabledIds.has('llm.pulse.v1')) strategyController.register(new LlmPulse(ctx.analyzer));

strategyController.start();
```

- [ ] **Step 4: Hook trade events into BarDriver**

Find the existing `ws.on('new-trade', ...)` handler and add inside its body, after the current logic:

```ts
const trade = data; // existing parsed trade
const pair = trade?.pair ?? trade?.s;
const ts = Number(trade?.timestamp ?? trade?.t ?? Date.now());
if (pair && Number.isFinite(ts)) strategyController.notifyTrade(pair, ts);
```

- [ ] **Step 5: Stop controller on shutdown**

In the existing graceful-shutdown handler block, add:

```ts
strategyController.stop();
```

- [ ] **Step 6: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Resolve any unused-var or missing-import issues.

- [ ] **Step 7: Smoke run**

Run: `npm start`
Expected: TUI boots; logs show strategies registered; signals start landing in `signal_log` table.

Manual SQL check:

```bash
PGPASSWORD=bot psql -h localhost -p 5433 -U bot -d coindcx_bot -c "SELECT strategy, type, COUNT(*) FROM signal_log GROUP BY 1,2 ORDER BY 1,2"
```

Expected: rows for `smc.rule.v1`, `ma.cross.v1`, `llm.pulse.v1` after warmup.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat(f4): wire StrategyController into runApp"
```

---

## Task 15: Backtest types + DataSource interface

**Files:**
- Create: `src/strategy/backtest/types.ts`
- Create: `src/strategy/backtest/data-source.ts`

- [ ] **Step 1: Write the types**

Create `src/strategy/backtest/types.ts`:

```ts
export type BacktestEventKind = 'bar_close' | 'tick' | 'gap';

export interface BacktestEvent {
  ts: number;
  kind: BacktestEventKind;
  pair: string;
  price?: number;
  high?: number;
  low?: number;
  tf?: string;
  raw?: unknown;
  reason?: string; // for gap
}

export interface DataSource {
  iterate(): AsyncIterable<BacktestEvent>;
  coverage(): number;
}
```

- [ ] **Step 2: Write factory stub**

Create `src/strategy/backtest/data-source.ts`:

```ts
import type { DataSource } from './types';

export type DataSourceKind = 'candles' | 'postgres-fills' | 'jsonl';

export interface DataSourceFactoryArgs {
  kind: DataSourceKind;
  pair: string;
  fromMs: number;
  toMs: number;
  tf?: string;
  jsonlPath?: string;
  pgPool?: any;
  candleFetcher?: (pair: string, tf: string, fromMs: number, toMs: number) => Promise<{ ts: number; o: number; h: number; l: number; c: number }[]>;
}

export async function makeDataSource(_args: DataSourceFactoryArgs): Promise<DataSource> {
  throw new Error('makeDataSource: implement per-kind in subsequent tasks');
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/strategy/backtest/types.ts src/strategy/backtest/data-source.ts
git commit -m "feat(f4): backtest DataSource types and factory stub"
```

---

## Task 16: CandleSource

**Files:**
- Create: `src/strategy/backtest/sources/candle-source.ts`
- Create: `tests/strategy/backtest/candle-source.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/backtest/candle-source.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { CandleSource } from '../../../src/strategy/backtest/sources/candle-source';

describe('CandleSource', () => {
  it('yields one bar_close per candle and zero gaps when complete', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ts: 0, o: 1, h: 2, l: 0, c: 1.5 },
      { ts: 60_000, o: 1.5, h: 2.5, l: 1.4, c: 2 },
    ]);
    const src = new CandleSource({ pair: 'p', tf: '1m', fromMs: 0, toMs: 120_000, fetcher });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    expect(events.filter(e => e.kind === 'bar_close')).toHaveLength(2);
    expect(events.filter(e => e.kind === 'gap')).toHaveLength(0);
    expect(src.coverage()).toBe(1);
  });

  it('emits gap for missing bars and reports coverage <1', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ts: 0, o: 1, h: 2, l: 0, c: 1 },
      { ts: 120_000, o: 1, h: 2, l: 0, c: 1 },
    ]);
    const src = new CandleSource({ pair: 'p', tf: '1m', fromMs: 0, toMs: 180_000, fetcher });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    const gaps = events.filter(e => e.kind === 'gap');
    expect(gaps.length).toBeGreaterThan(0);
    expect(src.coverage()).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/backtest/candle-source.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/backtest/sources/candle-source.ts`:

```ts
import type { BacktestEvent, DataSource } from '../types';
import { tfMs } from '../../scheduler/bar-driver';

interface RawCandle { ts: number; o: number; h: number; l: number; c: number }

export interface CandleSourceOptions {
  pair: string;
  tf: string;
  fromMs: number;
  toMs: number;
  fetcher: (pair: string, tf: string, fromMs: number, toMs: number) => Promise<RawCandle[]>;
}

export class CandleSource implements DataSource {
  private received = 0;
  private expected = 0;

  constructor(private opts: CandleSourceOptions) {}

  async *iterate(): AsyncIterable<BacktestEvent> {
    const candles = await this.opts.fetcher(this.opts.pair, this.opts.tf, this.opts.fromMs, this.opts.toMs);
    const tfDur = tfMs(this.opts.tf);
    this.expected = Math.floor((this.opts.toMs - this.opts.fromMs) / tfDur);
    let cursor = this.opts.fromMs;
    for (const c of candles) {
      while (cursor + tfDur <= c.ts) {
        yield { ts: cursor, kind: 'gap', pair: this.opts.pair, reason: 'missing bar' };
        cursor += tfDur;
      }
      yield { ts: c.ts, kind: 'bar_close', pair: this.opts.pair, tf: this.opts.tf, price: c.c, high: c.h, low: c.l, raw: c };
      this.received++;
      cursor = c.ts + tfDur;
    }
  }

  coverage(): number {
    return this.expected === 0 ? 0 : this.received / this.expected;
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/backtest/candle-source.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/backtest/sources/candle-source.ts tests/strategy/backtest/candle-source.test.ts
git commit -m "feat(f4): CandleSource backtest data iterator"
```

---

## Task 17: PostgresFillSource

**Files:**
- Create: `src/strategy/backtest/sources/postgres-fill-source.ts`
- Create: `tests/strategy/backtest/postgres-fill-source.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/backtest/postgres-fill-source.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PostgresFillSource } from '../../../src/strategy/backtest/sources/postgres-fill-source';

describe('PostgresFillSource', () => {
  it('queries and yields tick events sorted by executed_at', async () => {
    const rows = [
      { id: '1', pair: 'p', side: 'buy', price: '100', qty: '1', executed_at: new Date('2026-04-01T00:00:00Z') },
      { id: '2', pair: 'p', side: 'sell', price: '101', qty: '0.5', executed_at: new Date('2026-04-01T00:01:00Z') },
    ];
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    const src = new PostgresFillSource({ pool: pool as any, pair: 'p', fromMs: 0, toMs: Date.parse('2026-05-01') });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]!.price).toBe(100);
    expect(events[1]!.price).toBe(101);
    expect(src.coverage()).toBe(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/backtest/postgres-fill-source.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/backtest/sources/postgres-fill-source.ts`:

```ts
import type { Pool } from 'pg';
import type { BacktestEvent, DataSource } from '../types';

export interface PostgresFillSourceOptions {
  pool: Pool;
  pair: string;
  fromMs: number;
  toMs: number;
}

export class PostgresFillSource implements DataSource {
  private yielded = 0;

  constructor(private opts: PostgresFillSourceOptions) {}

  async *iterate(): AsyncIterable<BacktestEvent> {
    const r = await this.opts.pool.query(
      `SELECT id, pair, side, price, qty, executed_at FROM fills_ledger
       WHERE pair = $1 AND executed_at BETWEEN to_timestamp($2/1000.0) AND to_timestamp($3/1000.0)
       ORDER BY executed_at`,
      [this.opts.pair, this.opts.fromMs, this.opts.toMs],
    );
    for (const row of r.rows as any[]) {
      this.yielded++;
      yield {
        ts: new Date(row.executed_at).getTime(),
        kind: 'tick', pair: row.pair, price: Number(row.price), raw: row,
      };
    }
  }

  coverage(): number {
    return this.yielded === 0 ? 0 : 1;
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/backtest/postgres-fill-source.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/backtest/sources/postgres-fill-source.ts tests/strategy/backtest/postgres-fill-source.test.ts
git commit -m "feat(f4): PostgresFillSource backtest data iterator"
```

---

## Task 18: JsonlSource

**Files:**
- Create: `src/strategy/backtest/sources/jsonl-source.ts`
- Create: `tests/strategy/backtest/jsonl-source.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/backtest/jsonl-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JsonlSource } from '../../../src/strategy/backtest/sources/jsonl-source';

describe('JsonlSource', () => {
  it('reads jsonl file and yields tick events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'f4-'));
    const file = join(dir, 'probe.jsonl');
    writeFileSync(file, [
      JSON.stringify({ ts: 1000, ch: 'new-trade', raw: { pair: 'p', price: 100 } }),
      JSON.stringify({ ts: 2000, ch: 'new-trade', raw: { pair: 'p', price: 101 } }),
    ].join('\n'));
    const src = new JsonlSource({ path: file, pair: 'p', fromMs: 0, toMs: 10_000 });
    const events = [];
    for await (const e of src.iterate()) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]!.price).toBe(100);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/backtest/jsonl-source.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/backtest/sources/jsonl-source.ts`:

```ts
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { BacktestEvent, DataSource } from '../types';

export interface JsonlSourceOptions {
  path: string;
  pair: string;
  fromMs: number;
  toMs: number;
}

export class JsonlSource implements DataSource {
  private yielded = 0;

  constructor(private opts: JsonlSourceOptions) {}

  async *iterate(): AsyncIterable<BacktestEvent> {
    const rl = createInterface({ input: createReadStream(this.opts.path), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      const ts = Number(parsed.ts);
      if (!Number.isFinite(ts) || ts < this.opts.fromMs || ts > this.opts.toMs) continue;
      const pair = parsed.raw?.pair ?? parsed.raw?.s;
      if (pair !== this.opts.pair) continue;
      const price = Number(parsed.raw?.price ?? parsed.raw?.p);
      this.yielded++;
      yield { ts, kind: 'tick', pair, price: Number.isFinite(price) ? price : undefined, raw: parsed.raw };
    }
  }

  coverage(): number {
    return this.yielded === 0 ? 0 : 1;
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/backtest/jsonl-source.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/backtest/sources/jsonl-source.ts tests/strategy/backtest/jsonl-source.test.ts
git commit -m "feat(f4): JsonlSource backtest data iterator"
```

---

## Task 19: Simulator

**Files:**
- Create: `src/strategy/backtest/simulator.ts`
- Create: `tests/strategy/backtest/simulator.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/backtest/simulator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Simulator } from '../../../src/strategy/backtest/simulator';

describe('Simulator', () => {
  it('opens a long, hits TP, records trade with positive PnL', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.advanceClock(1000);
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);            // entry filled at next tick
    sim.markToMarket(3000, 110);            // TP hit
    const ledger = sim.tradeLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.exitReason).toBe('tp');
    expect(ledger[0]!.pnl).toBeCloseTo(10, 5);
  });

  it('hits SL when price drops below stop, negative PnL', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarket(3000, 94);
    const t = sim.tradeLedger()[0]!;
    expect(t.exitReason).toBe('sl');
    expect(t.pnl).toBeCloseTo(-5, 5);
  });

  it('pessimistic mode picks SL when SL and TP both crossed in same bar', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarketBar(3000, { high: 115, low: 90 });
    expect(sim.tradeLedger()[0]!.exitReason).toBe('sl');
  });

  it('opposite signal closes prior position then opens new', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarket(3000, 105);
    sim.applySignal({ side: 'SHORT', confidence: 0.9, entry: '105', stopLoss: '110', takeProfit: '100', reason: 'r' });
    sim.markToMarket(4000, 105);
    const ledger = sim.tradeLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.exitReason).toBe('flip');
    expect(sim.openPosition()?.side).toBe('SHORT');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/backtest/simulator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/strategy/backtest/simulator.ts`:

```ts
import type { StrategySignal, Side } from '../types';

export interface SimulatorOptions {
  pair: string;
  pessimistic: boolean;
}

export type ExitReason = 'tp' | 'sl' | 'ttl' | 'flip';

export interface OpenPosition {
  side: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  ttlMs?: number;
  reason: string;
}

export interface ClosedTrade extends OpenPosition {
  closedAt: number;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;
}

export class Simulator {
  private clock = 0;
  private position: OpenPosition | null = null;
  private pending: StrategySignal | null = null;
  private ledger: ClosedTrade[] = [];

  constructor(private opts: SimulatorOptions) {}

  advanceClock(ts: number): void {
    if (ts > this.clock) this.clock = ts;
  }

  applySignal(signal: StrategySignal): void {
    if (signal.side === 'WAIT') return;
    if (this.position) {
      this.close(this.clock, this.position.entry, 'flip');
    }
    this.pending = signal;
  }

  markToMarket(ts: number, price: number): void {
    this.advanceClock(ts);
    if (this.pending && Number.isFinite(price)) {
      const p = this.pending;
      this.position = {
        side: p.side as 'LONG' | 'SHORT',
        entry: Number(p.entry ?? price),
        stopLoss: Number(p.stopLoss ?? (p.side === 'LONG' ? price * 0.99 : price * 1.01)),
        takeProfit: Number(p.takeProfit ?? (p.side === 'LONG' ? price * 1.02 : price * 0.98)),
        openedAt: ts,
        ttlMs: p.ttlMs,
        reason: p.reason,
      };
      this.pending = null;
      return;
    }
    if (!this.position) return;
    if (this.shouldHitTp(price)) this.close(ts, this.position.takeProfit, 'tp');
    else if (this.shouldHitSl(price)) this.close(ts, this.position.stopLoss, 'sl');
    else if (this.position.ttlMs && ts - this.position.openedAt > this.position.ttlMs) {
      this.close(ts, price, 'ttl');
    }
  }

  markToMarketBar(ts: number, bar: { high: number; low: number }): void {
    this.advanceClock(ts);
    if (!this.position) return;
    const slHit = this.position.side === 'LONG' ? bar.low <= this.position.stopLoss : bar.high >= this.position.stopLoss;
    const tpHit = this.position.side === 'LONG' ? bar.high >= this.position.takeProfit : bar.low <= this.position.takeProfit;
    if (slHit && tpHit) {
      this.close(ts, this.opts.pessimistic ? this.position.stopLoss : this.position.takeProfit, this.opts.pessimistic ? 'sl' : 'tp');
      return;
    }
    if (slHit) this.close(ts, this.position.stopLoss, 'sl');
    else if (tpHit) this.close(ts, this.position.takeProfit, 'tp');
    else if (this.position.ttlMs && ts - this.position.openedAt > this.position.ttlMs) {
      this.close(ts, (bar.high + bar.low) / 2, 'ttl');
    }
  }

  private shouldHitTp(price: number): boolean {
    if (!this.position) return false;
    return this.position.side === 'LONG' ? price >= this.position.takeProfit : price <= this.position.takeProfit;
  }

  private shouldHitSl(price: number): boolean {
    if (!this.position) return false;
    return this.position.side === 'LONG' ? price <= this.position.stopLoss : price >= this.position.stopLoss;
  }

  private close(ts: number, exitPrice: number, reason: ExitReason): void {
    if (!this.position) return;
    const direction = this.position.side === 'LONG' ? 1 : -1;
    const pnl = (exitPrice - this.position.entry) * direction;
    this.ledger.push({ ...this.position, closedAt: ts, exitPrice, exitReason: reason, pnl });
    this.position = null;
  }

  openPosition(): OpenPosition | null {
    return this.position;
  }

  tradeLedger(): ClosedTrade[] {
    return this.ledger.slice();
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/backtest/simulator.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/backtest/simulator.ts tests/strategy/backtest/simulator.test.ts
git commit -m "feat(f4): backtest Simulator with SL/TP/TTL/flip handling"
```

---

## Task 20: Metrics + TradeLedger CSV

**Files:**
- Create: `src/strategy/backtest/metrics.ts`
- Create: `src/strategy/backtest/trade-ledger.ts`
- Create: `tests/strategy/backtest/metrics.test.ts`
- Create: `tests/strategy/backtest/trade-ledger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/strategy/backtest/metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../../src/strategy/backtest/metrics';
import type { ClosedTrade } from '../../../src/strategy/backtest/simulator';

const t = (pnl: number, openedAt: number, closedAt: number): ClosedTrade => ({
  side: pnl >= 0 ? 'LONG' : 'SHORT', entry: 100, stopLoss: 95, takeProfit: 110,
  openedAt, ttlMs: undefined, reason: 'r', closedAt, exitPrice: 100 + pnl, exitReason: pnl >= 0 ? 'tp' : 'sl', pnl,
});

describe('computeMetrics', () => {
  it('computes win rate, profit factor, max drawdown, total pnl', () => {
    const trades = [t(10, 0, 1), t(-5, 2, 3), t(15, 4, 5), t(-10, 6, 7)];
    const m = computeMetrics(trades);
    expect(m.totalPnl).toBe(10);
    expect(m.winRate).toBe(0.5);
    expect(m.profitFactor).toBeCloseTo(25 / 15, 5);
    expect(m.maxDrawdown).toBeGreaterThan(0);
    expect(m.tradeCount).toBe(4);
  });

  it('handles empty ledger', () => {
    const m = computeMetrics([]);
    expect(m.totalPnl).toBe(0);
    expect(m.tradeCount).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.sharpe).toBe(0);
  });
});
```

Create `tests/strategy/backtest/trade-ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportLedgerCsv } from '../../../src/strategy/backtest/trade-ledger';
import type { ClosedTrade } from '../../../src/strategy/backtest/simulator';

const t: ClosedTrade = {
  side: 'LONG', entry: 100, stopLoss: 95, takeProfit: 110,
  openedAt: 1000, closedAt: 2000, exitPrice: 110, exitReason: 'tp', pnl: 10, reason: 'r',
};

describe('exportLedgerCsv', () => {
  it('writes header + rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'f4-'));
    const path = join(dir, 'trades.csv');
    exportLedgerCsv(path, [t]);
    const text = readFileSync(path, 'utf8');
    const [header, row] = text.trim().split('\n');
    expect(header).toMatch(/openedAt,closedAt,side,entry,stopLoss,takeProfit,exitPrice,exitReason,pnl,reason/);
    expect(row).toContain('LONG');
    expect(row).toContain('10');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/backtest/metrics.test.ts tests/strategy/backtest/trade-ledger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement metrics**

Create `src/strategy/backtest/metrics.ts`:

```ts
import type { ClosedTrade } from './simulator';

export interface BacktestMetrics {
  totalPnl: number;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
}

export function computeMetrics(trades: ClosedTrade[]): BacktestMetrics {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return { totalPnl: 0, tradeCount: 0, winRate: 0, profitFactor: 0, sharpe: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0 };
  }
  let totalPnl = 0, wins = 0, gross = 0, grossLoss = 0;
  let runningEquity = 0, peak = 0, maxDD = 0;
  const returns: number[] = [];
  for (const t of trades) {
    totalPnl += t.pnl;
    if (t.pnl > 0) { wins++; gross += t.pnl; } else { grossLoss += Math.abs(t.pnl); }
    runningEquity += t.pnl;
    if (runningEquity > peak) peak = runningEquity;
    const dd = peak - runningEquity;
    if (dd > maxDD) maxDD = dd;
    returns.push(t.pnl);
  }
  const avg = totalPnl / tradeCount;
  const variance = returns.reduce((acc, r) => acc + (r - avg) ** 2, 0) / tradeCount;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev === 0 ? 0 : avg / stdev;
  const losses = tradeCount - wins;
  return {
    totalPnl,
    tradeCount,
    winRate: wins / tradeCount,
    profitFactor: grossLoss === 0 ? Infinity : gross / grossLoss,
    sharpe,
    maxDrawdown: maxDD,
    avgWin: wins === 0 ? 0 : gross / wins,
    avgLoss: losses === 0 ? 0 : grossLoss / losses,
  };
}
```

- [ ] **Step 4: Implement ledger CSV**

Create `src/strategy/backtest/trade-ledger.ts`:

```ts
import { writeFileSync } from 'fs';
import type { ClosedTrade } from './simulator';

const HEADER = 'openedAt,closedAt,side,entry,stopLoss,takeProfit,exitPrice,exitReason,pnl,reason';

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportLedgerCsv(path: string, trades: ClosedTrade[]): void {
  const lines = [HEADER];
  for (const t of trades) {
    lines.push([
      t.openedAt, t.closedAt, t.side, t.entry, t.stopLoss, t.takeProfit,
      t.exitPrice, t.exitReason, t.pnl, csvEscape(t.reason ?? ''),
    ].join(','));
  }
  writeFileSync(path, lines.join('\n') + '\n');
}
```

- [ ] **Step 5: Verify pass**

Run: `npx vitest run tests/strategy/backtest/metrics.test.ts tests/strategy/backtest/trade-ledger.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/strategy/backtest/metrics.ts src/strategy/backtest/trade-ledger.ts tests/strategy/backtest/metrics.test.ts tests/strategy/backtest/trade-ledger.test.ts
git commit -m "feat(f4): backtest metrics and trade-ledger CSV exporter"
```

---

## Task 21: Backtest Runner

**Files:**
- Create: `src/strategy/backtest/runner.ts`
- Create: `tests/strategy/backtest/runner.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/strategy/backtest/runner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runBacktest } from '../../../src/strategy/backtest/runner';
import { CandleSource } from '../../../src/strategy/backtest/sources/candle-source';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Strategy } from '../../../src/strategy/types';

const fakeMarket: any = {
  htf: { trend: 'uptrend', swing_high: 110, swing_low: 90 },
  ltf: { trend: 'uptrend', bos: false, swing_high: 110, swing_low: 90,
    displacement: { present: false, strength: 'weak' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0,0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};

const fakeStrategy: Strategy = {
  manifest: { id: 'fake', version: '1', mode: 'bar_close', barTimeframes: ['1m'], pairs: ['p'], description: '' },
  evaluate: () => ({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' }),
};

describe('runBacktest', () => {
  it('runs strategy through CandleSource → simulator and writes CSV', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ts: 0, o: 100, h: 105, l: 95, c: 100 },
      { ts: 60_000, o: 100, h: 115, l: 99, c: 110 },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'f4-'));
    const csv = join(dir, 'trades.csv');
    const summary = await runBacktest({
      strategy: fakeStrategy,
      pair: 'p',
      dataSource: new CandleSource({ pair: 'p', tf: '1m', fromMs: 0, toMs: 120_000, fetcher }),
      buildMarketState: () => fakeMarket,
      pessimistic: true,
      outCsv: csv,
    });
    expect(summary.metrics.tradeCount).toBeGreaterThan(0);
    const content = readFileSync(csv, 'utf8');
    expect(content).toContain('openedAt');
    expect(summary.coverage).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run tests/strategy/backtest/runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement runner**

Create `src/strategy/backtest/runner.ts`:

```ts
import type { MarketState, Candle } from '../ai/state-builder';
import type { Strategy, StrategyContext, StrategySignal } from '../types';
import type { AccountSnapshot } from '../../account/types';
import type { DataSource } from './types';
import { Simulator } from './simulator';
import { computeMetrics, type BacktestMetrics } from './metrics';
import { exportLedgerCsv } from './trade-ledger';

const EMPTY_ACCOUNT: AccountSnapshot = {
  positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' },
};

export interface BacktestSummary {
  metrics: BacktestMetrics;
  coverage: number;
  events: number;
}

export interface RunBacktestArgs {
  strategy: Strategy;
  pair: string;
  dataSource: DataSource;
  buildMarketState: (htf: Candle[], ltf: Candle[]) => MarketState | null;
  pessimistic: boolean;
  outCsv: string;
  warmupCandles?: Candle[];
}

export async function runBacktest(args: RunBacktestArgs): Promise<BacktestSummary> {
  if (args.strategy.warmup && args.warmupCandles) {
    await args.strategy.warmup({ pair: args.pair, candles: args.warmupCandles });
  }
  const sim = new Simulator({ pair: args.pair, pessimistic: args.pessimistic });
  let events = 0;
  for await (const e of args.dataSource.iterate()) {
    events++;
    sim.advanceClock(e.ts);
    if (e.kind === 'gap') continue;
    const market = args.buildMarketState([], []);
    if (!market) continue;
    const ctx: StrategyContext = {
      ts: e.ts, pair: args.pair, marketState: market,
      account: EMPTY_ACCOUNT, recentFills: [],
      trigger: e.kind === 'bar_close'
        ? { kind: 'bar_close', tf: e.tf ?? '1m' }
        : { kind: 'tick', channel: 'new-trade', raw: e.raw },
    };
    const raw = await Promise.resolve(args.strategy.evaluate(ctx));
    if (raw && raw.side !== 'WAIT') sim.applySignal(raw as StrategySignal);
    if (e.kind === 'bar_close' && e.high !== undefined && e.low !== undefined) {
      sim.markToMarketBar(e.ts, { high: e.high, low: e.low });
    } else if (e.price !== undefined) {
      sim.markToMarket(e.ts, e.price);
    }
  }
  const metrics = computeMetrics(sim.tradeLedger());
  exportLedgerCsv(args.outCsv, sim.tradeLedger());
  return { metrics, coverage: args.dataSource.coverage(), events };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/strategy/backtest/runner.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/backtest/runner.ts tests/strategy/backtest/runner.test.ts
git commit -m "feat(f4): backtest runner orchestrating data source + simulator + metrics"
```

---

## Task 22: Backtest CLI

**Files:**
- Create: `src/cli/backtest.ts`
- Modify: `package.json`

- [ ] **Step 1: Add npm script**

Edit `package.json` `scripts`:

```json
"backtest": "ts-node src/cli/backtest.ts"
```

- [ ] **Step 2: Implement CLI**

Create `src/cli/backtest.ts`:

```ts
/* eslint-disable no-console */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../config/config';
import { CoinDCXApi } from '../gateways/coindcx-api';
import { MarketStateBuilder } from '../ai/state-builder';
import { SmcRule } from '../strategy/strategies/smc-rule';
import { MaCross } from '../strategy/strategies/ma-cross';
import { LlmPulse } from '../strategy/strategies/llm-pulse';
import { CandleSource } from '../strategy/backtest/sources/candle-source';
import { PostgresFillSource } from '../strategy/backtest/sources/postgres-fill-source';
import { JsonlSource } from '../strategy/backtest/sources/jsonl-source';
import { runBacktest } from '../strategy/backtest/runner';
import type { Strategy } from '../strategy/types';
import type { DataSource } from '../strategy/backtest/types';
import { AiAnalyzer } from '../ai/analyzer';
import { createLogger } from '../logging/logger';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith('--') && argv[i + 1] !== undefined) {
      out[a.slice(2)] = argv[i + 1]!;
      i++;
    }
  }
  return out;
}

function pickStrategy(id: string, logger: any): Strategy {
  if (id === 'smc.rule.v1') return new SmcRule();
  if (id === 'ma.cross.v1') return new MaCross();
  if (id === 'llm.pulse.v1') return new LlmPulse(new AiAnalyzer(config as any, logger));
  throw new Error(`unknown strategy: ${id}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategyId = args.strategy ?? 'smc.rule.v1';
  const pair = args.pair ?? 'B-BTC_USDT';
  const fromMs = Date.parse(args.from ?? '2026-04-01T00:00:00Z');
  const toMs = Date.parse(args.to ?? '2026-04-25T00:00:00Z');
  const sourceKind = args.source ?? 'candles';
  const tf = args.tf ?? '15m';
  const out = args.out ?? join(config.BACKTEST_OUTPUT_DIR ?? './logs/backtest', `${strategyId}-${pair}-${Date.now()}.csv`);
  mkdirSync(config.BACKTEST_OUTPUT_DIR ?? './logs/backtest', { recursive: true });

  const logger = createLogger(config as any);
  const stateBuilder = new MarketStateBuilder(logger);
  const strategy = pickStrategy(strategyId, logger);

  let dataSource: DataSource;
  if (sourceKind === 'candles') {
    dataSource = new CandleSource({
      pair, tf, fromMs, toMs,
      fetcher: async (p, t, fm, tm) => {
        const raw: any[] = await CoinDCXApi.getCandles(p, t, fm, tm);
        return raw.map(r => ({ ts: Number(r.ts ?? r.time ?? r.timestamp), o: Number(r.o ?? r.open),
          h: Number(r.h ?? r.high), l: Number(r.l ?? r.low), c: Number(r.c ?? r.close) }));
      },
    });
  } else if (sourceKind === 'postgres-fills') {
    const pool = new Pool({ connectionString: config.PG_URL });
    dataSource = new PostgresFillSource({ pool, pair, fromMs, toMs });
  } else if (sourceKind === 'jsonl') {
    dataSource = new JsonlSource({ path: args.path ?? '', pair, fromMs, toMs });
  } else {
    throw new Error(`unknown source: ${sourceKind}`);
  }

  console.error(`[backtest] strategy=${strategyId} pair=${pair} source=${sourceKind} from=${args.from} to=${args.to}`);
  const summary = await runBacktest({
    strategy, pair, dataSource,
    buildMarketState: (htf, ltf) => stateBuilder.build(htf, ltf, null, []),
    pessimistic: config.BACKTEST_PESSIMISTIC ?? true,
    outCsv: out,
  });
  console.log(JSON.stringify({
    strategyId, pair, fromMs, toMs, source: sourceKind,
    metrics: summary.metrics, coverage: summary.coverage, events: summary.events, csv: out,
  }, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('[backtest] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `getCandles` doesn't exist on `CoinDCXApi`, fix CLI to use `getMarketDetails` or whatever exists; the runner test already covers the iterator without depending on this method.

- [ ] **Step 4: Commit**

```bash
git add src/cli/backtest.ts package.json
git commit -m "feat(f4): backtest CLI entrypoint (npm run backtest)"
```

---

## Task 23: Integration test (Postgres + mocked WS/Ollama; gated by SKIP_DOCKER_TESTS)

**Files:**
- Create: `tests/strategy/controller.int.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/strategy/controller.int.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { SignalBus } from '../../src/signals/bus';
import { StrategyController } from '../../src/strategy/controller';
import type { Strategy } from '../../src/strategy/types';

const DOCKER_OFF = process.env.SKIP_DOCKER_TESTS === '1';
const skip = DOCKER_OFF ? describe.skip : describe;
const PG = process.env.PG_URL ?? 'postgres://bot:bot@localhost:5433/coindcx_bot';

const fakeMarket: any = {
  htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
  ltf: { trend: 'uptrend', bos: true, swing_high: 1, swing_low: 0,
    displacement: { present: true, strength: 'strong' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0,0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};
const account: any = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

skip('StrategyController integration', () => {
  let pool: Pool;
  let bus: SignalBus;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    bus = new SignalBus({ pool, sinks: [{ name: 'memory', emit: async () => {} }] });
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query("DELETE FROM signal_log WHERE strategy LIKE 'int-%'");
  });

  function makeStrategy(id: string, side: 'LONG'|'SHORT'|'WAIT'): Strategy {
    return {
      manifest: { id, version: '1', mode: 'interval', intervalMs: 100, pairs: ['p'], description: '' },
      evaluate: () => ({ side, confidence: 0.9, reason: 'r' }),
    };
  }

  it('emits signals to signal_log via SignalBus', async () => {
    const ctrl = new StrategyController({
      ws: new EventEmitter(), signalBus: bus,
      buildMarketState: () => fakeMarket,
      candleProvider: { ltf: () => [], htf: () => [] },
      accountSnapshot: () => account, recentFills: () => [],
      extractPair: (raw: any) => raw?.pair,
      config: { timeoutMs: 1000, errorThreshold: 3, emitWait: false, backpressureDropRatioAlarm: 0.5 },
    });
    ctrl.register(makeStrategy('int-a', 'LONG'));
    await ctrl.runOnce('int-a', 'p', { kind: 'interval' });
    const r = await pool.query("SELECT * FROM signal_log WHERE strategy='int-a'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.type).toBe('strategy.long');
  });

  it('records strategy.disabled after threshold errors', async () => {
    const ctrl = new StrategyController({
      ws: new EventEmitter(), signalBus: bus,
      buildMarketState: () => fakeMarket,
      candleProvider: { ltf: () => [], htf: () => [] },
      accountSnapshot: () => account, recentFills: () => [],
      extractPair: (raw: any) => raw?.pair,
      config: { timeoutMs: 1000, errorThreshold: 3, emitWait: false, backpressureDropRatioAlarm: 0.5 },
    });
    ctrl.register({
      manifest: { id: 'int-err', version: '1', mode: 'interval', intervalMs: 100, pairs: ['p'], description: '' },
      evaluate: () => { throw new Error('boom'); },
    });
    for (let i = 0; i < 3; i++) await ctrl.runOnce('int-err', 'p', { kind: 'interval' });
    const r = await pool.query("SELECT type FROM signal_log WHERE strategy='int-err'");
    const types = r.rows.map(x => x.type).sort();
    expect(types).toContain('strategy.disabled');
  });
});
```

- [ ] **Step 2: Run integration**

Run: `npx vitest run tests/strategy/controller.int.test.ts`
Expected: 2 tests pass with Postgres up.

- [ ] **Step 3: Verify Docker-skip**

Run: `SKIP_DOCKER_TESTS=1 npx vitest run tests/strategy/controller.int.test.ts`
Expected: skipped, suite passes.

- [ ] **Step 4: Commit**

```bash
git add tests/strategy/controller.int.test.ts
git commit -m "test(f4): integration tests for StrategyController"
```

---

## Task 24: Quality gate + README phase update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run full quality gate**

Run: `npm run check`
Expected: typecheck + tests green. Lint warnings acceptable (pre-existing baseline). Hard errors must be fixed; if any are introduced by F4 code, fix at the F4 source.

- [ ] **Step 2: Update README**

Replace the Phases block in `README.md`:

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

### Phase 3: Account state reconciler (shipped)
- Per-entity stores (positions, balances, orders) + fills ledger
- WS-first ingest with heartbeat-driven forced sweeps and 5-minute drift sweep
- Divergence detector with severity classification
- Audit changelog and full Postgres history (orders ↔ fills ↔ positions linkage)
- Lifecycle, threshold, and divergence signals on the SignalBus
- Read-only forever — only signed-read endpoints used

### Phase 4: Strategy framework + backtester (current)
- Pluggable Strategy interface with mixed cadence (interval / tick / bar_close)
- Per-pair instance isolation; auto-disable on error threshold
- RiskFilter passthrough boundary for F5
- Built-in strategies: SmcRule, MaCross, LlmPulse (wraps existing AiAnalyzer)
- Backtester reuses Strategy contract; CandleSource / PostgresFillSource / JsonlSource
- Standard metrics (Sharpe, max drawdown, profit factor, win rate) + per-trade CSV
- CLI: `npm run backtest -- --strategy <id> --pair <pair> --from <iso> --to <iso> --source candles --tf 15m`

## Roadmap

- F5: risk-alert engine (real RiskFilter impl)
- F6: TUI v2 + Prometheus metrics
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(f4): update README phase status"
```

- [ ] **Step 4: Final verification**

Run: `npm run check`
Expected: tests green; typecheck clean.

Acceptance smoke tests:

1. `npm start` — TUI boots; `signal_log` table accumulates rows from `smc.rule.v1`, `ma.cross.v1`, `llm.pulse.v1`.
2. `STRATEGY_ENABLED_IDS=smc.rule.v1 npm start` — only SmcRule emits.
3. `npm run backtest -- --strategy smc.rule.v1 --pair B-BTC_USDT --from 2026-04-01T00:00:00Z --to 2026-04-08T00:00:00Z --source candles --tf 15m` — JSON summary printed; CSV in `logs/backtest/`.

---

## Notes for the implementer

- `MarketStateBuilder.build` returns the same runtime shape as before; only its TS signature is tightened (Task 1).
- `LlmPulse` keeps using the existing `AiAnalyzer` instance from `ctx.analyzer`; no behavior change, just packaged behind the Strategy interface.
- The candle store wired in Task 14 starts empty; existing F2 candle subscriptions populate it. If F2 currently lacks a per-pair candle stream, populate the store from the trade stream by aggregating, or drive `MarketStateBuilder` directly off the existing `MarketStateBuilder` consumer pattern. Verify which path is wired before declaring Task 14 done.
- `MaCross.evaluate` reads `marketState.htf.swing_high` as a price proxy because the existing `StrategyContext` does not expose raw candles. If Task 14 wires a richer candle accessor into the context, refactor `MaCross` to consume that and update its tests.
- `CoinDCXApi.getCandles` is referenced in the backtest CLI; it's used in F3 enhancements. Verify the signature; adjust the fetcher in `src/cli/backtest.ts` to match.
- The `expandStarPairs` helper in `StrategyController` returns `[]` as a placeholder. Replace with `ctx.config.COINDCX_PAIRS` when wiring runApp (Task 14) so `pairs: ['*']` actually expands to configured pairs.
