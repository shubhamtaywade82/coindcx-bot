import { EventEmitter } from 'events';
import { CoinDCXApi } from '../gateways/coindcx-api';
import type { Candle } from '../ai/state-builder';
import type { AppLogger } from '../logging/logger';

export interface TimeframeConfig {
  interval: string;
  historyLength: number;
  refreshMs: number;
}

export interface MtfSnapshot {
  pair: string;
  timeframes: Record<string, Candle[]>;
  lastUpdatedAt: number;
}

export class MultiTimeframeStore extends EventEmitter {
  private stores = new Map<string, Map<string, Candle[]>>(); // pair -> tf -> candles
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly config: TimeframeConfig[];

  constructor(
    private logger: AppLogger,
    config?: TimeframeConfig[]
  ) {
    super();
    this.config = config ?? [
      { interval: '1m', historyLength: 100, refreshMs: 30000 },
      { interval: '15m', historyLength: 50, refreshMs: 60000 },
      { interval: '1h', historyLength: 24, refreshMs: 300000 },
    ];
  }

  async subscribe(pair: string): Promise<void> {
    if (this.stores.has(pair)) return;

    const tfMap = new Map<string, Candle[]>();
    for (const tf of this.config) {
      try {
        const raw = await CoinDCXApi.getCandles(pair, tf.interval, tf.historyLength);
        const candles = this.normalizeCandles(raw);
        tfMap.set(tf.interval, candles);
        this.logger.info({ mod: 'mtf', pair, interval: tf.interval, count: candles.length }, 'MTF seeded');
      } catch (err: any) {
        this.logger.error({ mod: 'mtf', pair, interval: tf.interval, err: err.message }, 'MTF seed failed');
        // We still continue to attempt other timeframes
      }
    }
    this.stores.set(pair, tfMap);

    // Start polling loops per timeframe
    for (const tf of this.config) {
      const timer = setInterval(async () => {
        try {
          const raw = await CoinDCXApi.getCandles(pair, tf.interval, 2);
          const latest = this.normalizeCandles(raw);
          this.mergeCandles(pair, tf.interval, latest, tf.historyLength);
        } catch (err: any) {
          this.logger.warn({ mod: 'mtf', pair, interval: tf.interval, err: err.message }, 'MTF poll failed');
        }
      }, tf.refreshMs);
      this.timers.set(`${pair}:${tf.interval}`, timer);
    }

    this.emit('subscribed', pair);
  }

  private normalizeCandles(raw: any[]): Candle[] {
    return raw.map(c => ({
      timestamp: Number(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    })).sort((a, b) => a.timestamp - b.timestamp);
  }

  private mergeCandles(pair: string, interval: string, incoming: Candle[], maxLen: number) {
    const tfMap = this.stores.get(pair);
    if (!tfMap) return;

    const existing = tfMap.get(interval) || [];
    const merged = [...existing];

    for (const candle of incoming) {
      const last = merged[merged.length - 1];
      if (last && last.timestamp === candle.timestamp) {
        merged[merged.length - 1] = candle;
      } else if (!last || candle.timestamp > last.timestamp) {
        merged.push(candle);
      }
    }

    if (merged.length > maxLen) merged.splice(0, merged.length - maxLen);
    
    tfMap.set(interval, merged);
    this.emit('update', { pair, interval, candle: merged[merged.length - 1] });
  }

  getSnapshot(pair: string): MtfSnapshot | null {
    const tfMap = this.stores.get(pair);
    if (!tfMap) return null;

    const timeframes: Record<string, Candle[]> = {};
    tfMap.forEach((candles, tf) => { timeframes[tf] = candles; });

    return {
      pair,
      timeframes,
      lastUpdatedAt: Date.now(),
    };
  }

  unsubscribe(pair: string): void {
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${pair}:`)) {
        clearInterval(timer);
        this.timers.delete(key);
      }
    }
    this.stores.delete(pair);
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.stores.clear();
  }
}
