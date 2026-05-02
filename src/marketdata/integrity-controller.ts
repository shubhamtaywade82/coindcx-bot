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
import { toCoinDcxFuturesInstrument } from '../utils/format';

export interface IntegrityDeps {
  config: Config;
  logger: AppLogger;
  pool: Pool;
  audit: Audit;
  bus: SignalBus;
  ws: import('node:events').EventEmitter & {
    reconnect: () => void;
    subscribe?: (ch: string, pair: string) => void;
    unsubscribe?: (ch: string, pair: string) => void;
  };
  restFetchOrderBook: (pair: string) => Promise<{
    asks: Array<[string, string]>;
    bids: Array<[string, string]>;
    ts: number;
  }>;
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
        const sig = {
          id: ulid(), ts: new Date().toISOString(),
          strategy: 'integrity', type: 'stale_feed',
          severity: 'warn' as const, payload: { ...e } as Record<string, unknown>,
        };
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
        const sig = {
          id: ulid(), ts: new Date().toISOString(),
          strategy: 'integrity', type: 'heartbeat_lost',
          severity: 'critical' as const, payload: {},
        };
        void bus.emit(sig);
        audit.recordEvent({ kind: 'alert', source: 'integrity', payload: { type: 'heartbeat_lost' } });
      },
    });
    this.timeSync = new TimeSync({
      thresholdMs: config.SKEW_THRESHOLD_MS,
      fetchExchangeMs: deps.fetchExchangeMs,
      fetchNtpMs: deps.fetchNtpMs,
      onSkew: (e) => {
        const sig = {
          id: ulid(), ts: new Date().toISOString(),
          strategy: 'integrity', type: 'clock_skew',
          severity: e.severity, payload: { ...e } as Record<string, unknown>,
        };
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
      const sig = {
        id: ulid(), ts: new Date().toISOString(),
        strategy: 'integrity', type: 'book_resync',
        pair: e.pair, severity: 'warn' as const, payload: e,
      };
      void bus.emit(sig);
      audit.recordEvent({ kind: 'reconcile_diff', source: 'integrity', payload: e });
    });
    this.resync.on('failed', (e) => {
      const sig = {
        id: ulid(), ts: new Date().toISOString(),
        strategy: 'integrity', type: 'book_resync_failed',
        pair: e.pair, severity: 'critical' as const, payload: e,
      };
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
    const rawPair: string | undefined = raw?.s ?? raw?.pair;
    const pair: string | undefined = rawPair ? toCoinDcxFuturesInstrument(rawPair) : undefined;
    if (pair) this.stale.touch(channel, pair);

    // CoinDCX sends asks/bids as objects {"price":"qty"} — normalize to Array<[string, string]>
    const toArr = (v: any): Array<[string, string]> => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') return Object.entries(v).map(([p, q]) => [p, String(q)] as [string, string]);
      return [];
    };

    if (channel === 'depth-snapshot' && pair) {
      this.books.onDepthSnapshot(pair, {
        asks: toArr(raw.asks),
        bids: toArr(raw.bids),
        ts,
      });
    } else if (channel === 'depth-update' && pair) {
      this.books.onDepthDelta(pair, {
        asks: toArr(raw.asks),
        bids: toArr(raw.bids),
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
