import { describe, expect, it, vi } from 'vitest';
import { CandleHistoryIngestor } from '../../../src/marketdata/candles/candle-history-ingestor';

describe('CandleHistoryIngestor', () => {
  it('paginates with max bars per call and persists each page', async () => {
    const api = {
      getFuturesInstrumentCandles: vi.fn(async (_pair: string, opts: { from?: number; to?: number }) => {
        const from = Number(opts.from ?? 0);
        const to = Number(opts.to ?? 0);
        const rows: any[] = [];
        for (let ts = from; ts <= to; ts += 60) {
          rows.push([ts, 100, 110, 90, 105, 10]);
        }
        return rows;
      }),
    };
    const persistence = {
      persistMany: vi.fn(async (input: { candles: unknown[] }) => input.candles.length),
    };
    const ingestor = new CandleHistoryIngestor({
      api: api as any,
      persistence: persistence as any,
      maxBarsPerCall: 3,
    });

    const summary = await ingestor.ingestRange({
      pair: 'B-BTC_USDT',
      timeframe: '1m',
      fromMs: 0,
      toMs: 300_000,
    });

    expect(summary.pages).toBe(2);
    expect(summary.fetched).toBe(6);
    expect(summary.persisted).toBe(6);
    expect(api.getFuturesInstrumentCandles).toHaveBeenCalledTimes(2);
    expect(api.getFuturesInstrumentCandles).toHaveBeenNthCalledWith(
      1,
      'B-BTC_USDT',
      expect.objectContaining({ resolution: '1', from: 0, to: 120, limit: 3 }),
    );
    expect(api.getFuturesInstrumentCandles).toHaveBeenNthCalledWith(
      2,
      'B-BTC_USDT',
      expect.objectContaining({ resolution: '1', from: 180, to: 300, limit: 3 }),
    );
    expect(persistence.persistMany).toHaveBeenCalledTimes(2);
  });

  it('ingests multiple intervals and aggregates per-timeframe summaries', async () => {
    const api = {
      getFuturesInstrumentCandles: vi.fn(async (_pair: string, _opts: unknown) => [[0, 1, 2, 0.5, 1.5, 10]]),
    };
    const persistence = {
      persistMany: vi.fn(async (input: { candles: unknown[] }) => input.candles.length),
    };
    const ingestor = new CandleHistoryIngestor({
      api: api as any,
      persistence: persistence as any,
      maxBarsPerCall: 1000,
    });

    const summary = await ingestor.ingestMultiIntervalHistory({
      pair: 'B-ETH_USDT',
      timeframes: ['1m', '15m', '1h'],
      fromMs: 0,
      toMs: 0,
    });

    expect(summary.byTimeframe).toHaveLength(3);
    expect(summary.pages).toBe(3);
    expect(summary.fetched).toBe(3);
    expect(summary.persisted).toBe(3);
    expect(summary.byTimeframe.map((item) => item.timeframe)).toEqual(['1m', '15m', '1h']);
  });

  it('clamps requested bars per call at exchange max of 1000', async () => {
    const api = {
      getFuturesInstrumentCandles: vi.fn(async () => [[0, 1, 2, 0.5, 1.5, 10]]),
    };
    const ingestor = new CandleHistoryIngestor({
      api: api as any,
      maxBarsPerCall: 5000,
    });

    await ingestor.ingestRange({
      pair: 'B-BTC_USDT',
      timeframe: '1m',
      fromMs: 0,
      toMs: 0,
    });

    expect(api.getFuturesInstrumentCandles).toHaveBeenCalledWith(
      'B-BTC_USDT',
      expect.objectContaining({ limit: 1000 }),
    );
  });
});
