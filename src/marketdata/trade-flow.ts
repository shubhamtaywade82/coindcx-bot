import { toCoinDcxFuturesInstrument } from '../utils/format';

export interface TradeTick {
  ts: number;       // ms
  price: number;
  qty: number;
  buyAggressive: boolean; // true = buyer hit ask, false = seller hit bid
}

export interface TradeWindowMetrics {
  windowMs: number;
  trades: number;
  buyVol: number;
  sellVol: number;
  totalVol: number;
  delta: number;       // buyVol - sellVol
  imbalance: number;   // delta / totalVol, in [-1, 1] (0 if no trades)
}

export interface TradeMetrics {
  pair: string;
  lastTradeTs: number;
  windows: { '60s': TradeWindowMetrics; '300s': TradeWindowMetrics };
  cvd: number;         // cumulative delta since process start (per pair)
}

const DEFAULT_WINDOWS_MS = [60_000, 300_000] as const;

/**
 * Per-pair rolling trade-flow aggregator.
 *
 * CoinDCX `new-trade` payload `m` flag convention (matches Binance): true means
 * buyer is maker, i.e. the seller hit the bid → sell-aggressive. We translate to
 * `buyAggressive = !m`.
 */
export class TradeFlow {
  private buffers = new Map<string, TradeTick[]>();
  private cvds = new Map<string, number>();
  private readonly maxWindowMs: number;

  constructor(windowsMs: readonly number[] = DEFAULT_WINDOWS_MS) {
    this.maxWindowMs = Math.max(...windowsMs);
  }

  ingestRaw(raw: { T?: number; p?: string | number; q?: string | number; m?: number | boolean; s?: string; pair?: string }): void {
    const pairRaw = raw?.s ?? raw?.pair;
    if (!pairRaw) return;
    const ts = Number(raw.T);
    const price = parseFloat(String(raw.p));
    const qty = parseFloat(String(raw.q));
    if (!Number.isFinite(ts) || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return;
    const buyAggressive = !(raw.m === 1 || raw.m === true);
    this.ingest(toCoinDcxFuturesInstrument(String(pairRaw)), { ts, price, qty, buyAggressive });
  }

  ingest(pair: string, tick: TradeTick): void {
    let buf = this.buffers.get(pair);
    if (!buf) {
      buf = [];
      this.buffers.set(pair, buf);
    }
    buf.push(tick);
    const cutoff = tick.ts - this.maxWindowMs;
    let dropFrom = 0;
    while (dropFrom < buf.length && buf[dropFrom]!.ts < cutoff) dropFrom += 1;
    if (dropFrom > 0) buf.splice(0, dropFrom);
    const delta = tick.buyAggressive ? tick.qty : -tick.qty;
    this.cvds.set(pair, (this.cvds.get(pair) ?? 0) + delta);
  }

  metrics(pair: string, now: number = Date.now()): TradeMetrics | null {
    const buf = this.buffers.get(pair);
    if (!buf || buf.length === 0) return null;
    const win = (windowMs: number): TradeWindowMetrics => {
      const cutoff = now - windowMs;
      let buyVol = 0, sellVol = 0, count = 0;
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        const t = buf[i]!;
        if (t.ts < cutoff) break;
        count += 1;
        if (t.buyAggressive) buyVol += t.qty; else sellVol += t.qty;
      }
      const totalVol = buyVol + sellVol;
      const delta = buyVol - sellVol;
      return { windowMs, trades: count, buyVol, sellVol, totalVol, delta, imbalance: totalVol > 0 ? delta / totalVol : 0 };
    };
    return {
      pair,
      lastTradeTs: buf[buf.length - 1]!.ts,
      windows: { '60s': win(60_000), '300s': win(300_000) },
      cvd: this.cvds.get(pair) ?? 0,
    };
  }
}
