# F2 — Market Data Integrity

**Date:** 2026-04-25
**Status:** Draft for review
**Phase:** 2 of 6
**Depends on:** F1 (config, logger, audit, SignalBus, ReadOnlyGuard)

## Hard Constraint

Read-only forever. F2 produces alert signals via F1's `SignalBus`; never places, cancels, or modifies orders. REST resync calls go through `ReadOnlyGuard` (`/exchange/v1/derivatives/data/orderbook` is GET → already on the safe list).

## Goals

A trustworthy market-data layer feeding F4 strategies. Detect, alarm, and self-heal on:

- L2 book divergence (gap, missed delta, stale snapshot)
- Stale ticks (channel went quiet)
- Excessive latency
- Clock skew (local ↔ exchange ↔ NTP)
- Heartbeat loss

## Decisions (made during brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Scope | Full — book integrity + heartbeat + stale + latency + time-sync |
| Q2 | Field schema source | Defensive design + always-on probe; CoinDCX docs incomplete |
| Q3 | Resync path | Hybrid — WS resub first, REST fallback after timeout, rate-limit aware |
| Q4 | Latency tracking | Both ws-rtt and tick-age, with histograms (p50/p95/p99) |
| Q5 | Time sync | Exchange server time + NTP, both checked |
| Q6 | Stale alarm | Hybrid — `max(channel_floor, 3 × p99_inter_arrival)` |
| Q7 | Probe mode | CLI script + always-on tail-ring buffer |

## Architecture

```
src/
  marketdata/
    book/
      orderbook.ts          per-pair L2 book, snapshot+delta, checksum, state machine
      book-manager.ts       multi-pair registry, resync orchestration
      resync.ts             gap → ws-resub then REST fallback (rate-limited)
    health/
      heartbeat.ts          socket.io ping/pong watchdog
      stale-watcher.ts      per-channel inter-arrival monitor, hybrid threshold
      latency.ts            ws-rtt + tick-age histograms (HDR-like reservoir)
      time-sync.ts          exchange server-time + NTP offset, periodic check
    probe/
      probe-recorder.ts     CLI mode: record N seconds of raw frames to JSONL
      tail-buffer.ts        ring of last 1000 raw frames per channel
    rate-limit/
      rest-budget.ts        token bucket guarding REST resnapshot calls
    integrity-controller.ts wires all health modules; emits ALERT signals via F1 bus
  cli/
    probe.ts                npm run probe entrypoint
```

## Components

### book/orderbook.ts

`class OrderBook` per pair.

State: `'init' | 'live' | 'resyncing' | 'broken'`.

Internals: `Map<priceStr, qtyStr>` for asks and bids. Sorted views computed on demand (small enough for top-N reads at TUI cadence; revisit if profiling shows hot path).

API:
- `applySnapshot(asks, bids, ts, seq?)` — replace whole book, transition `init|resyncing → live`.
- `applyDelta(asks, bids, ts, seq?, prevSeq?)` — qty=0 deletes; emits `'gap'` event if seq present and `prevSeq !== lastSeq`, or if delta removes a price not in book.
- `topN(n)` — `{ asks, bids }` sorted top N.
- `bestBid()`, `bestAsk()`, `spread()`, `midPrice()`.
- `checksum()` — SHA1 hex over `top25_asks ++ top25_bids` rendered as `"price:qty"` lines.
- `state()`.

Events (EventEmitter): `'gap'`, `'applied'`, `'snapshot'`.

### book/book-manager.ts

`class BookManager`. Holds `Map<pair, OrderBook>`. Wires WS handlers (`depth-snapshot`, `depth-update`) to the correct book. On `book.gap`, calls `resync.requestResync(pair, reason)`. Tracks per-pair `lastSeenAt`.

### book/resync.ts

`class ResyncOrchestrator`. On request:

1. Mark book `resyncing`.
2. WS unsubscribe + resubscribe to depth channel for pair.
3. If no `depth-snapshot` arrives in `RESYNC_WS_TIMEOUT_MS` (default `3000`), call REST `GET /exchange/v1/derivatives/data/orderbook?pair=<...>` via `RestBudget.acquire(pair)`.
4. Apply snapshot, transition to `live`.
5. Audit `kind='reconcile_diff'`, payload `{pair, reason, durationMs, viaRest}`.
6. Emit signal: `severity='warn'`, `type='book_resync'`, `payload={pair, reason, viaRest}`.

If REST fails or RestBudget rejects: log + alarm `severity='critical'`, queue retry next cycle.

### health/heartbeat.ts

Wraps `CoinDCXWs`. Socket.io v2.4 client exposes engine `pong` events; subscribe and time RTT vs the request stamp. If no pong within `HEARTBEAT_TIMEOUT_MS` (default `35000`), emit `severity='critical'` `type='heartbeat_lost'`, force `ws.reconnect()`. Reconnect itself audits `kind='ws_reconnect'` (already wired in F1).

### health/stale-watcher.ts

Per `(channel, pair?)` keeps a reservoir (1024 samples) of inter-arrival ms. Threshold = `max(channel_floor, 3 × p99)`.

Channel floors (env-overridable):
- `STALE_FLOOR_currentPrices=5000`
- `STALE_FLOOR_newTrade=30000`
- `STALE_FLOOR_depthUpdate=10000`

Tick on `setInterval(1000)`: if `now - lastSeen > threshold`, emit `severity='warn'` `type='stale_feed'` once, re-arm on next event.

### health/latency.ts

Two histograms per channel: `wsRtt` (heartbeat pong) and `tickAge` (`now - msg.T`). HDR-style reservoir 4096 samples. API: `record(channel, kind, ms)`, `snapshot(channel)` → `{count, p50, p95, p99, max}`. Periodic dump every 60s as a structured log line. Wires to Prometheus in F6.

### health/time-sync.ts

`setInterval(15 * 60_000)`:

1. Read `Date` response header from any GET request to `api.coindcx.com` (or `GET /exchange/v1/time` if available — verified during probe).
2. NTP query to `pool.ntp.org` via `ntp-client` package.
3. Compute `localVsExchange`, `localVsNtp`, `exchangeVsNtp`.

If `|any skew| > SKEW_THRESHOLD_MS` (default `500`): emit `severity='critical'` `type='clock_skew'` with payload of all three offsets.

Fallback: if exchange time unavailable, NTP only with `severity='warn'`. If NTP unavailable, exchange only with `severity='warn'`.

### probe/probe-recorder.ts

CLI run via `src/cli/probe.ts`. Args (commander or yargs): `--pair`, `--duration`, `--channels` (comma list, default `depth,trade,prices`).

Connects WS, raw frames written to `${LOG_DIR}/probe-YYYYMMDD-HHMMSS.jsonl`, one line per frame: `{ts, channel, raw}`. No book/health side effects. Exits after duration. Useful for empirical schema validation when CoinDCX docs are sparse.

### probe/tail-buffer.ts

Always-on. Per channel ring `Array<{ts, raw}>`, capped 1000. API: `push(channel, frame)`, `dump(channel?)` writes JSONL to `${LOG_DIR}/tail-<channel>-<ts>.jsonl`.

Auto-dump triggers:
- on any gap-detect alarm (dump all channels)
- SIGUSR1 (manual operator dump)

### rate-limit/rest-budget.ts

Token bucket protecting REST resync calls. Default 6/min global + 1/min per pair (env-tunable). `acquire(pair)` resolves when token available or rejects after `REST_BUDGET_TIMEOUT_MS` (default `5000`). Caller logs + skips resync attempt this cycle on rejection.

CoinDCX REST limit assumed conservative (~60/min). Probe verifies this; lower the budget if observed limits are tighter.

### integrity-controller.ts

`class IntegrityController`. Wired in `bootstrap` after F1 context build. Owns `BookManager`, `Heartbeat`, `StaleWatcher`, `LatencyTracker`, `TimeSync`, `ResyncOrchestrator`, `RestBudget`, `TailBuffer`.

Receives raw WS frames via existing handlers, fans out to consumers, captures into TailBuffer. Emits all alerts/signals through F1 `SignalBus`. On boot: subscribe to configured pairs (`config.pairs`) for depth, trades, prices.

## Data Flow

```
WS frame ──► coindcx-ws.ts ──► IntegrityController.ingest(channel, raw)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
       TailBuffer.push     StaleWatcher.touch   Latency.record(tickAge)
                                                      │
                                                      ▼
              ┌───────────── route by channel ────────────────┐
              ▼                  ▼                              ▼
       depth-snapshot      depth-update                  new-trade / prices
              │                  │                              │
              ▼                  ▼                              ▼
       BookManager         BookManager.applyDelta       (forwarded to F4 later)
       .applySnapshot            │
                            gap detected?
                                  ▼
                         ResyncOrchestrator
                         ├─► WS unsubscribe+resubscribe
                         ├─► (timeout) RestBudget.acquire ──► REST snapshot
                         ├─► applySnapshot
                         └─► bus.emit({severity:warn,type:'book_resync'})
                             audit.recordEvent({kind:'reconcile_diff'})

Heartbeat ──pong──► Latency.record(wsRtt)
       │
       └── timeout ──► bus.emit({severity:critical,type:'heartbeat_lost'}) + WS.reconnect

TimeSync (15min) ──► local/exchange/ntp offsets ──► alarm if |skew|>threshold
Latency snapshot (60s) ──► structured log entry per channel
```

## Gap Detection (no seq case)

Without exchange-published sequence numbers, detect divergence via:

1. **Local checksum diff.** Every `CHECKSUM_INTERVAL_MS` (default `30000`) recompute `OrderBook.checksum()` and compare against a fresh REST snapshot's checksum (rate-limit-safe — at most once per 10 min per pair). Mismatch → gap.
2. **Logical anomaly.** Delta with empty payload, delta removing a price not in book, or time-gap exceeding stale threshold while book is known active. Any → gap.
3. **Probe-driven escalation.** If the probe captures seq fields (e.g. `U`/`u`/`pu`), upgrade to strict seq check. Behavior gated by env `BOOK_INTEGRITY_MODE=heuristic|strict` (default `heuristic`).

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| WS disconnect | existing reconnect; on re-up, all books → `resyncing` |
| Heartbeat timeout | force reconnect, critical alert |
| REST snapshot 4xx | abort resync, critical alert, schedule retry next cycle |
| REST snapshot 5xx / timeout | exponential backoff (1s, 4s, 16s) within budget |
| RestBudget exhausted | log + skip, queue resync for next slot |
| NTP unreachable | exchange-only fallback, warn |
| Exchange `server_time` unavailable | NTP-only fallback, warn |
| Probe write fail | log + continue (probe non-critical) |

## Testing

- **Unit:** `OrderBook.applySnapshot/applyDelta/checksum` with synthetic frames + golden checksums; `StaleWatcher` reservoir + threshold math; `Latency` histogram math; `TimeSync` with mocked NTP + nock REST.
- **Integration:** synthetic WS server replays recorded probe JSONL into `IntegrityController`. Verify gap injection → resync → book recovery; audit row + signal emitted.
- **Property tests:** random delta sequences vs reference book via `fast-check` — checksum stable, no leaks, state machine sound.
- **Probe e2e:** `npm run probe -- --pair B-SOL_USDT --duration 5` writes ≥ 1 frame per subscribed channel, JSON parses.
- **CI:** `npm run check` includes all of the above.

## Build Sequence (for implementation plan)

1. `marketdata/probe/tail-buffer.ts` + tests
2. `cli/probe.ts` + `npm run probe`; capture ≥ 1 frame per channel manually
3. `marketdata/rate-limit/rest-budget.ts` + tests
4. `marketdata/book/orderbook.ts` + unit + property tests
5. `marketdata/book/book-manager.ts` + tests
6. `marketdata/book/resync.ts` (WS resub + REST fallback) + tests with nock
7. `marketdata/health/heartbeat.ts` + tests with fake socket emitter
8. `marketdata/health/latency.ts` + tests
9. `marketdata/health/stale-watcher.ts` + tests
10. `marketdata/health/time-sync.ts` + tests with nock + mock NTP
11. `marketdata/integrity-controller.ts` wires everything
12. Wire `IntegrityController` into `runApp(ctx)`; remove naive depth handlers from `index.ts`
13. TUI badge: real `LAT: <wsRtt>ms`, book state per focused pair
14. Probe-replay integration test
15. README update + roadmap tick

## Out of Scope (Deferred)

- Prometheus exposition (F6)
- Strategy consumption of book/trade feeds (F4)
- Account state reconciliation (F3)
- TUI v2 (F6) — only minimal status badge in this phase

## Acceptance Criteria

- `npm run probe -- --pair B-SOL_USDT --duration 5` produces JSONL with raw frames; exits cleanly.
- Synthetic gap injection forces book → `resyncing`, REST snapshot fetched (within budget), book → `live`, audit row `kind='reconcile_diff'`, alert signal `type='book_resync'` reaches all sinks.
- Heartbeat-lost test: silenced fake socket triggers critical alert + reconnect within `HEARTBEAT_TIMEOUT_MS`.
- Stale-watcher test: paused feed beyond threshold → warn alert; resumed feed → re-arm.
- TimeSync test: forced 1s skew via mock → critical alert; `|skew| < threshold` → silent.
- TUI status bar shows real `LAT: <wsRtt>ms`, not the hard-coded `24ms`.
- Tail buffer auto-dumps on gap-detect — file exists post-event.
- All books recover after WS disconnect → reconnect.
- `npm run check` green.

## References

- F1 spec: `docs/superpowers/specs/2026-04-25-f1-reliability-foundation-design.md`
- F1 plan: `docs/superpowers/plans/2026-04-25-f1-reliability-foundation.md`
- CoinDCX docs: https://docs.coindcx.com/ (futures socket field schemas largely undocumented; probe will fill the gap)
- Existing handlers being replaced: `src/index.ts` (`depth-snapshot`, `depth-update`)
