import { CoinDCXApi } from '../../gateways/coindcx-api';
import type { CandleHistoryPersistence, PersistableCandle } from '../../persistence/candle-history-persistence';

const MAX_PAGE_BARS = 1000;

const RESOLUTION_BY_TIMEFRAME: Record<string, { resolution: string; stepSeconds: number }> = {
  '1m': { resolution: '1', stepSeconds: 60 },
  '5m': { resolution: '5', stepSeconds: 5 * 60 },
  '15m': { resolution: '15', stepSeconds: 15 * 60 },
  '30m': { resolution: '30', stepSeconds: 30 * 60 },
  '1h': { resolution: '60', stepSeconds: 60 * 60 },
  '4h': { resolution: '240', stepSeconds: 4 * 60 * 60 },
  '1d': { resolution: '1D', stepSeconds: 24 * 60 * 60 },
};

interface CoinDcxFuturesCandleFetcher {
  getFuturesInstrumentCandles(
    instrument: string,
    opts: { resolution?: string; from?: number; to?: number; limit?: number },
  ): Promise<unknown>;
}

export interface CandleIngestRequest {
  pair: string;
  timeframe: string;
  fromMs: number;
  toMs: number;
  source?: string;
}

export interface CandleIngestSummary {
  pair: string;
  timeframe: string;
  pages: number;
  fetched: number;
  persisted: number;
}

export interface MultiIntervalIngestRequest {
  pair: string;
  timeframes: string[];
  fromMs: number;
  toMs: number;
  source?: string;
}

export interface MultiIntervalIngestSummary {
  pair: string;
  byTimeframe: CandleIngestSummary[];
  fetched: number;
  persisted: number;
  pages: number;
}

export interface CandleHistoryIngestorOptions {
  api?: CoinDcxFuturesCandleFetcher;
  persistence?: CandleHistoryPersistence;
  maxBarsPerCall?: number;
}

export class CandleHistoryIngestor {
  private readonly api: CoinDcxFuturesCandleFetcher;
  private readonly maxBarsPerCall: number;

  constructor(private readonly opts: CandleHistoryIngestorOptions = {}) {
    this.api = opts.api ?? CoinDCXApi;
    this.maxBarsPerCall = Math.max(1, Math.min(MAX_PAGE_BARS, Math.trunc(opts.maxBarsPerCall ?? MAX_PAGE_BARS)));
  }

  async ingestRange(input: CandleIngestRequest): Promise<CandleIngestSummary> {
    const tfMeta = resolutionForTimeframe(input.timeframe);
    let cursorFromSec = Math.floor(input.fromMs / 1000);
    const toSec = Math.floor(input.toMs / 1000);
    let pages = 0;
    let fetched = 0;
    let persisted = 0;
    const source = input.source ?? 'coindcx.market_data.candlesticks';

    while (cursorFromSec <= toSec) {
      const pageToSec = Math.min(
        toSec,
        cursorFromSec + tfMeta.stepSeconds * (this.maxBarsPerCall - 1),
      );
      const pageRaw = await this.api.getFuturesInstrumentCandles(input.pair, {
        resolution: tfMeta.resolution,
        from: cursorFromSec,
        to: pageToSec,
        limit: this.maxBarsPerCall,
      });
      pages += 1;
      const parsed = normalizeCandles(pageRaw, tfMeta.stepSeconds * 1000);
      if (parsed.length === 0) {
        cursorFromSec = pageToSec + tfMeta.stepSeconds;
        continue;
      }

      fetched += parsed.length;
      if (this.opts.persistence) {
        persisted += await this.opts.persistence.persistMany({
          pair: input.pair,
          timeframe: input.timeframe,
          source,
          candles: parsed,
        });
      }

      const latest = parsed[parsed.length - 1];
      if (!latest) break;
      const nextCursor = Math.floor(latest.openTimeMs / 1000) + tfMeta.stepSeconds;
      cursorFromSec = nextCursor > cursorFromSec ? nextCursor : pageToSec + tfMeta.stepSeconds;
    }

    return {
      pair: input.pair,
      timeframe: input.timeframe,
      pages,
      fetched,
      persisted,
    };
  }

  async ingestMultiIntervalHistory(input: MultiIntervalIngestRequest): Promise<MultiIntervalIngestSummary> {
    const byTimeframe: CandleIngestSummary[] = [];
    for (const timeframe of input.timeframes) {
      byTimeframe.push(await this.ingestRange({
        pair: input.pair,
        timeframe,
        fromMs: input.fromMs,
        toMs: input.toMs,
        source: input.source,
      }));
    }
    return {
      pair: input.pair,
      byTimeframe,
      fetched: byTimeframe.reduce((sum, item) => sum + item.fetched, 0),
      persisted: byTimeframe.reduce((sum, item) => sum + item.persisted, 0),
      pages: byTimeframe.reduce((sum, item) => sum + item.pages, 0),
    };
  }
}

function resolutionForTimeframe(timeframe: string): { resolution: string; stepSeconds: number } {
  const found = RESOLUTION_BY_TIMEFRAME[timeframe];
  if (!found) throw new Error(`unsupported timeframe for candle ingestion: ${timeframe}`);
  return found;
}

function normalizeCandles(raw: unknown, stepMs: number): PersistableCandle[] {
  const rows = extractCandleRows(raw);
  const byOpenTime = new Map<number, PersistableCandle>();
  for (const row of rows) {
    const parsed = normalizeSingleCandle(row, stepMs);
    if (!parsed) continue;
    byOpenTime.set(parsed.openTimeMs, parsed);
  }
  return [...byOpenTime.values()].sort((left, right) => left.openTimeMs - right.openTimeMs);
}

function extractCandleRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const body = raw as Record<string, unknown>;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

function normalizeSingleCandle(raw: unknown, stepMs: number): PersistableCandle | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return parseArrayCandle(raw, stepMs);
  }
  if (typeof raw === 'object') {
    return parseObjectCandle(raw as Record<string, unknown>, stepMs);
  }
  return null;
}

function parseArrayCandle(raw: unknown[], stepMs: number): PersistableCandle | null {
  const openTimeMs = parseTimestampMs(raw[0]);
  const open = parseFiniteNumber(raw[1]);
  const high = parseFiniteNumber(raw[2]);
  const low = parseFiniteNumber(raw[3]);
  const close = parseFiniteNumber(raw[4]);
  const volume = parseFiniteNumber(raw[5], 0);
  if (!isCandleOHLCValid(openTimeMs, open, high, low, close, volume)) return null;
  return {
    openTimeMs,
    closeTimeMs: openTimeMs + stepMs,
    open,
    high,
    low,
    close,
    volume,
    payload: {
      provider: 'coindcx',
    },
  };
}

function parseObjectCandle(raw: Record<string, unknown>, stepMs: number): PersistableCandle | null {
  const openTimeMs = parseTimestampMs(raw.time ?? raw.t ?? raw.timestamp ?? raw.open_time);
  const open = parseFiniteNumber(raw.open ?? raw.o);
  const high = parseFiniteNumber(raw.high ?? raw.h);
  const low = parseFiniteNumber(raw.low ?? raw.l);
  const close = parseFiniteNumber(raw.close ?? raw.c);
  const volume = parseFiniteNumber(raw.volume ?? raw.v, 0);
  if (!isCandleOHLCValid(openTimeMs, open, high, low, close, volume)) return null;
  return {
    openTimeMs,
    closeTimeMs: openTimeMs + stepMs,
    open,
    high,
    low,
    close,
    volume,
    payload: {
      provider: 'coindcx',
      raw,
    },
  };
}

function parseTimestampMs(input: unknown): number {
  const n = parseFiniteNumber(input, Number.NaN);
  if (!Number.isFinite(n)) return Number.NaN;
  return n >= 1_000_000_000_000 ? n : n * 1000;
}

function parseFiniteNumber(input: unknown, fallback = Number.NaN): number {
  const parsed = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isCandleOHLCValid(
  openTimeMs: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): boolean {
  return (
    Number.isFinite(openTimeMs) &&
    Number.isFinite(open) &&
    Number.isFinite(high) &&
    Number.isFinite(low) &&
    Number.isFinite(close) &&
    Number.isFinite(volume)
  );
}
