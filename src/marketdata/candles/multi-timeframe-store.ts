import { EventEmitter } from 'node:events';
import type { Candle } from '../../ai/state-builder';
import type { AppLogger } from '../../logging/logger';

export type TfInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface TfConfig {
  interval: TfInterval;
  historyLength: number;
  /** REST poll interval in ms. 0 = seed-only (updates via applyWsCandle). */
  pollMs: number;
}

export const DEFAULT_TF_CONFIGS: TfConfig[] = [
  { interval: '1m',  historyLength: 100, pollMs: 0 },        // live via WS candlestick
  { interval: '15m', historyLength: 50,  pollMs: 60_000 },   // REST poll 60 s
  { interval: '1h',  historyLength: 30,  pollMs: 300_000 },  // REST poll 5 min
];

export interface MtfStoreOptions {
  configs: TfConfig[];
  /**
   * Returns candles oldest-first with Candle.timestamp in **milliseconds**.
   * Called during seed and periodic REST polls.
   */
  fetchCandles: (pair: string, tf: string, limit: number) => Promise<Candle[]>;
  logger?: AppLogger;
}

export interface MtfSnapshot {
  pair: string;
  timeframes: Record<string, Candle[]>;
  lastUpdatedAt: number;
}

/** Emits: 'update' → { pair: string; tf: string; candle: Candle } */
export class MultiTimeframeStore extends EventEmitter {
  // pair (raw, e.g. "B-SOL_USDT") → tf → candles
  private stores = new Map<string, Map<string, Candle[]>>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts: MtfStoreOptions) {
    super();
  }

  /**
   * Seed all configured timeframes from REST and start REST polling timers.
   * Call once per pair at startup.
   */
  async seed(pair: string): Promise<void> {
    const tfMap = new Map<string, Candle[]>();
    await Promise.all(
      this.opts.configs.map(async (cfg) => {
        try {
          const candles = await this.opts.fetchCandles(pair, cfg.interval, cfg.historyLength);
          tfMap.set(cfg.interval, candles);
          this.opts.logger?.info(
            { mod: 'mtf', pair, tf: cfg.interval, count: candles.length },
            'seeded',
          );
        } catch (err: any) {
          this.opts.logger?.warn(
            { mod: 'mtf', pair, tf: cfg.interval, err: err.message },
            'seed failed — starting empty',
          );
          tfMap.set(cfg.interval, []);
        }
      }),
    );
    this.stores.set(pair, tfMap);

    // Start REST poll timers for intervals that want it
    for (const cfg of this.opts.configs) {
      if (cfg.pollMs <= 0) continue;
      const key = `${pair}:${cfg.interval}`;
      const timer = setInterval(async () => {
        try {
          // Fetch last 3 bars; enough to update/close the current bar
          const latest = await this.opts.fetchCandles(pair, cfg.interval, 3);
          this.merge(pair, cfg.interval, latest, cfg.historyLength);
        } catch (err: any) {
          this.opts.logger?.warn(
            { mod: 'mtf', pair, tf: cfg.interval, err: err.message },
            'poll failed',
          );
        }
      }, cfg.pollMs);
      this.timers.set(key, timer);
    }
  }

  /**
   * Ingest a live candle from the WS `candlestick` event.
   * raw.open_time is in SECONDS (CoinDCX convention).
   */
  applyWsCandle(
    pair: string,
    tf: string,
    raw: {
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      open_time: number;
    },
  ): void {
    const candle: Candle = {
      timestamp: raw.open_time * 1000, // seconds → milliseconds
      open: parseFloat(raw.open),
      high: parseFloat(raw.high),
      low: parseFloat(raw.low),
      close: parseFloat(raw.close),
      volume: parseFloat(raw.volume),
    };
    const cfg = this.opts.configs.find((c) => c.interval === tf);
    this.merge(pair, tf, [candle], cfg?.historyLength ?? 100);
  }

  /** Merge incoming candles (oldest-first) into the stored array. */
  private merge(pair: string, tf: string, incoming: Candle[], maxLen: number): void {
    const tfMap = this.stores.get(pair);
    if (!tfMap) return;
    const existing = tfMap.get(tf) ?? [];
    const merged = [...existing];
    for (const c of incoming) {
      const last = merged[merged.length - 1];
      if (last && last.timestamp === c.timestamp) {
        // Update current (still-open) bar in-place
        merged[merged.length - 1] = c;
      } else if (!last || c.timestamp > last.timestamp) {
        merged.push(c);
      }
    }
    if (merged.length > maxLen) merged.splice(0, merged.length - maxLen);
    tfMap.set(tf, merged);
    this.emit('update', { pair, tf, candle: merged[merged.length - 1] });
  }

  /** Return all candles for a given pair + timeframe, oldest-first. */
  get(pair: string, tf: string): Candle[] {
    return this.stores.get(pair)?.get(tf) ?? [];
  }

  /** Snapshot of all timeframes for a pair. Returns null if pair not seeded. */
  getSnapshot(pair: string): MtfSnapshot | null {
    const tfMap = this.stores.get(pair);
    if (!tfMap) return null;
    const timeframes: Record<string, Candle[]> = {};
    tfMap.forEach((candles, tf) => { timeframes[tf] = candles; });
    return { pair, timeframes, lastUpdatedAt: Date.now() };
  }

  /** Stop polling and drop data for a pair. */
  unseed(pair: string): void {
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${pair}:`)) {
        clearInterval(timer);
        this.timers.delete(key);
      }
    }
    this.stores.delete(pair);
  }

  /** Tear down all timers and stores. */
  destroy(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.stores.clear();
  }
}
