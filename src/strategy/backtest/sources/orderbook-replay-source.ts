import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { OrderBook } from '../../../marketdata/book/orderbook';
import type { BacktestEvent, DataSource } from '../types';

export interface OrderbookReplaySourceOptions {
  path: string;
  pair: string;
  fromMs: number;
  toMs: number;
}

type ReplayChannel = 'depth-snapshot' | 'depth-update' | 'new-trade';

interface ReplayRow {
  ts: number;
  channel: ReplayChannel;
  raw: Record<string, unknown>;
}

export class OrderbookReplaySource implements DataSource {
  private yielded = 0;
  private scanned = 0;
  private readonly book: OrderBook;

  constructor(private readonly opts: OrderbookReplaySourceOptions) {
    this.book = new OrderBook(opts.pair);
  }

  async *iterate(): AsyncIterable<BacktestEvent> {
    const stream = this.opts.path.endsWith('.gz')
      ? createReadStream(this.opts.path).pipe(createGunzip())
      : createReadStream(this.opts.path);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const row = parseReplayLine(line);
      if (!row) continue;
      this.scanned += 1;
      if (row.ts < this.opts.fromMs || row.ts > this.opts.toMs) continue;
      const pair = cleanPair(row.raw.s ?? row.raw.pair);
      if (pair !== cleanPair(this.opts.pair)) continue;
      const event = this.processReplayEvent(row);
      if (!event) continue;
      this.yielded += 1;
      yield event;
    }
  }

  coverage(): number {
    return this.scanned === 0 ? 0 : this.yielded / this.scanned;
  }

  private processReplayEvent(row: ReplayRow): BacktestEvent | null {
    if (row.channel === 'new-trade') {
      const price = parseFiniteNumber(row.raw.price ?? row.raw.p);
      if (!Number.isFinite(price)) return null;
      return {
        ts: row.ts,
        kind: 'tick',
        pair: this.opts.pair,
        price,
        raw: row.raw,
      };
    }

    const asks = normalizeBookLevels(row.raw.asks);
    const bids = normalizeBookLevels(row.raw.bids);
    if (row.channel === 'depth-snapshot') {
      this.book.applySnapshot(asks, bids, row.ts, parseFiniteInteger(row.raw.seq));
      return {
        ts: row.ts,
        kind: 'tick',
        pair: this.opts.pair,
        asks,
        bids,
        seq: parseFiniteInteger(row.raw.seq),
        raw: row.raw,
      };
    } else {
      this.book.applyDelta(
        asks,
        bids,
        row.ts,
        parseFiniteInteger(row.raw.seq),
        parseFiniteInteger(row.raw.prevSeq),
      );
      return {
        ts: row.ts,
        kind: 'tick',
        pair: this.opts.pair,
        asks,
        bids,
        seq: parseFiniteInteger(row.raw.seq),
        prevSeq: parseFiniteInteger(row.raw.prevSeq),
        raw: row.raw,
      };
    }
  }
}

function parseReplayLine(line: string): ReplayRow | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  const ts = parseFiniteInteger(row.ts);
  const channel = row.channel;
  const raw = row.raw;
  if (ts === undefined || !Number.isFinite(ts)) return null;
  if (channel !== 'depth-snapshot' && channel !== 'depth-update' && channel !== 'new-trade') return null;
  if (!raw || typeof raw !== 'object') return null;
  return {
    ts,
    channel,
    raw: raw as Record<string, unknown>,
  };
}

function normalizeBookLevels(raw: unknown): Array<[string, string]> {
  if (Array.isArray(raw)) {
    const levels: Array<[string, string]> = [];
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const price = String(row[0]);
      const qty = String(row[1]);
      levels.push([price, qty]);
    }
    return levels;
  }
  if (!raw || typeof raw !== 'object') return [];
  const levels: Array<[string, string]> = [];
  for (const [price, qty] of Object.entries(raw as Record<string, unknown>)) {
    levels.push([price, String(qty)]);
  }
  return levels;
}

function parseFiniteNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function parseFiniteInteger(value: unknown): number | undefined {
  const n = parseFiniteNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function cleanPair(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}
