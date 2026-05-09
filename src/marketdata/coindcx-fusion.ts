import { EventEmitter } from 'events';
import { MultiTimeframeStore, type MtfSnapshot } from './candles/multi-timeframe-store';
import { BookManager } from './book/book-manager';
import type { Candle } from '../ai/state-builder';
import type { AppLogger } from '../logging/logger';
import { toCoinDcxFuturesInstrument } from '../utils/format';
import type { TradeFlow, TradeMetrics } from './trade-flow';
import {
  estimateSyntheticFundingRate,
  resolveMarkPrice,
  resolveOpenInterest,
} from './data-gap-policy';
import { computeMicrostructureMetrics, type MicrostructureMetrics } from './microstructure';
import { computeIntradayIndicators, type IntradayIndicators } from './intraday-indicators';
import {
  computeSwingIndicators,
  type SwingHistoryPoint,
  type SwingIndicators,
} from './swing-indicators';
import type { LiquidityRaidSnapshot } from './liquidity/types';
import type { LiquidityEngine } from './liquidity/liquidity-engine';

export interface L2Snapshot {
  pair: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  bidDepth: number;  // total qty within 1% of best bid
  askDepth: number;
  timestamp: number;
}

export interface FusionSnapshot {
  pair: string;
  l2: L2Snapshot;
  ltp: {
    price: number;
    bid: number;
    ask: number;
    markPrice: number;
    volume24h: number;
    change24h: number;
    openInterest?: number;
    syntheticFundingRate?: number;
    basis?: number;
  };
  candles: MtfSnapshot['timeframes'];
  bookMetrics: {
    bidAskRatio: number;
    bidWallPrice: number | null;
    bidWallSize: number;
    askWallPrice: number | null;
    askWallSize: number;
    imbalance: 'bid-heavy' | 'ask-heavy' | 'neutral';
  };
  candleMetrics: {
    trend1m: 'up' | 'down' | 'sideways';
    trend15m: 'up' | 'down' | 'sideways';
    volumeProfile: 'increasing' | 'decreasing' | 'flat';
  };
  tradeMetrics?: TradeMetrics;
  microstructure: MicrostructureMetrics;
  intraday: IntradayIndicators;
  swing: SwingIndicators;
  /** Stateful buy/sell-side raid model (tape + OHLCV); absent when engine disabled. */
  liquidityRaid?: LiquidityRaidSnapshot;
  generatedAt: number;
}

function parseLevelNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class CoinDcxFusion extends EventEmitter {
  private ltpState = new Map<string, FusionSnapshot['ltp']>();
  private latestFusion = new Map<string, FusionSnapshot>();
  private swingHistoryByPair = new Map<string, SwingHistoryPoint[]>();
  private readonly swingHistoryLimit = 600;
  private readonly now: () => number;

  constructor(
    private logger: AppLogger,
    private ws: EventEmitter,
    private mtf: MultiTimeframeStore,
    private books: BookManager,
    private trades?: TradeFlow,
    clock: () => number = Date.now,
    private readonly liquidity?: LiquidityEngine | null,
  ) {
    super();
    this.now = clock;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // LTP from ticker or currentPrices
    this.ws.on('currentPrices@futures#update', (data: any) => {
      const prices = data.prices || data;
      if (!prices || typeof prices !== 'object') return;

      Object.entries(prices).forEach(([rawPair, info]: [string, any]) => {
        if (!info || typeof info !== 'object') return;
        const pair = toCoinDcxFuturesInstrument(rawPair);
        const markPrice = resolveMarkPrice({ markPrice: info.mp, lastPrice: info.ls });
        const lastPrice = resolveMarkPrice({ markPrice: info.ls, lastPrice: info.mp });
        const openInterest = resolveOpenInterest(info);
        const syntheticFunding = estimateSyntheticFundingRate({
          futuresMarkPrice: markPrice,
          spotLastPrice: lastPrice,
        });
        this.ltpState.set(pair, {
          price: lastPrice ?? 0,
          bid: parseFloat(info.b || '0'), // Some feeds might have bid/ask
          ask: parseFloat(info.a || '0'),
          markPrice: markPrice ?? 0,
          volume24h: parseFloat(info.v || '0'),
          change24h: parseFloat(info.pc || '0'),
          ...(openInterest !== undefined ? { openInterest } : {}),
          ...(syntheticFunding
            ? {
                syntheticFundingRate: syntheticFunding.estimatedFundingRate,
                basis: syntheticFunding.basisRatio,
              }
            : {}),
        });
        this.maybeGenerateFusion(pair);
      });
    });

    // We can also listen to depth updates from ws if we want to trigger on every tick,
    // but maybe it's better to trigger on ltp or candle updates.
    this.ws.on('depth-update', (data: any) => {
      const s = data?.s ?? data?.pair;
      if (s) this.maybeGenerateFusion(toCoinDcxFuturesInstrument(s));
    });

    if (this.trades) {
      this.ws.on('new-trade', (data: any) => {
        this.trades!.ingestRaw(data);
        const s = data?.s ?? data?.pair;
        if (s) this.maybeGenerateFusion(toCoinDcxFuturesInstrument(s));
      });
    }

    this.mtf.on('update', ({ pair }: { pair: string }) => {
      this.maybeGenerateFusion(pair);
    });
  }

  private maybeGenerateFusion(pair: string): void {
    const book = this.books.get(pair);
    const ltp = this.ltpState.get(pair);
    const mtfSnap = this.mtf.getSnapshot(pair);

    if (!book || !ltp || !mtfSnap) return;
    const nowMs = this.now();
    this.recordSwingHistory(pair, ltp, nowMs);

    const snapshot = this.buildFusion(pair, book, ltp, mtfSnap, nowMs);
    this.latestFusion.set(pair, snapshot);
    this.emit('fusion', snapshot);
  }

  private buildFusion(
    pair: string,
    book: import('./book/orderbook').OrderBook,
    ltp: FusionSnapshot['ltp'],
    mtf: MtfSnapshot,
    nowMs: number,
  ): FusionSnapshot {
    const top = book.topN(50);
    const bestBid = top.bids[0] ? parseFloat(top.bids[0].price) : 0;
    const bestAsk = top.asks[0] ? parseFloat(top.asks[0].price) : 0;
    const spread = bestAsk - bestBid;

    // Depth within 1%
    const bidDepth1pct = top.bids
      .filter(b => parseFloat(b.price) >= bestBid * 0.99)
      .reduce((sum, b) => sum + parseFloat(b.qty), 0);
    const askDepth1pct = top.asks
      .filter(a => parseFloat(a.price) <= bestAsk * 1.01)
      .reduce((sum, a) => sum + parseFloat(a.qty), 0);

    // Walls
    const bidWall = top.bids.reduce(
      (max, bid) => (parseLevelNumber(bid.qty) > parseLevelNumber(max.qty) ? bid : max),
      top.bids[0] || { price: '0', qty: '0' },
    );
    const askWall = top.asks.reduce(
      (max, ask) => (parseLevelNumber(ask.qty) > parseLevelNumber(max.qty) ? ask : max),
      top.asks[0] || { price: '0', qty: '0' },
    );
    const bidWallPrice = parseLevelNumber(bidWall.price);
    const askWallPrice = parseLevelNumber(askWall.price);
    const bidWallSize = parseLevelNumber(bidWall.qty);
    const askWallSize = parseLevelNumber(askWall.qty);

    const trend = (candles: Candle[]): 'up' | 'down' | 'sideways' => {
      if (candles.length < 3) return 'sideways';
      const recent = candles.slice(-3);
      const higherHighs = recent.every((c, i) => i === 0 || c.high >= recent[i-1].high);
      const higherLows = recent.every((c, i) => i === 0 || c.low >= recent[i-1].low);
      const lowerHighs = recent.every((c, i) => i === 0 || c.high <= recent[i-1].high);
      const lowerLows = recent.every((c, i) => i === 0 || c.low <= recent[i-1].low);
      if (higherHighs && higherLows) return 'up';
      if (lowerHighs && lowerLows) return 'down';
      return 'sideways';
    };

    const volProfile = (candles: Candle[]): 'increasing' | 'decreasing' | 'flat' => {
      if (candles.length < 5) return 'flat';
      const avgRecent = candles.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
      const avgPrev = candles.slice(-6, -3).reduce((s, c) => s + c.volume, 0) / 3;
      if (avgRecent > avgPrev * 1.2) return 'increasing';
      if (avgRecent < avgPrev * 0.8) return 'decreasing';
      return 'flat';
    };

    const swing = computeSwingIndicators({
      pair,
      candles1h: mtf.timeframes['1h'] || [],
      ltp,
      historyByPair: this.swingHistoryByPair,
      nowMs,
    });

    const poolTf = this.liquidity?.poolTimeframe ?? '15m';
    const liquidityRaid = this.liquidity?.step({
      pair,
      poolCandles: mtf.timeframes[poolTf] || [],
      ltf1mCandles: mtf.timeframes['1m'] || [],
      bestBid,
      bestAsk,
      ltpPrice: ltp.price,
      lastTradePrice: this.trades?.lastTick(pair)?.price,
      tradeMetrics: this.trades?.metrics(pair) ?? null,
      swing,
      nowMs,
    });

    return {
      pair,
      l2: {
        pair,
        bestBid,
        bestAsk,
        spread,
        bidDepth: bidDepth1pct,
        askDepth: askDepth1pct,
        timestamp: nowMs,
      },
      ltp,
      candles: mtf.timeframes,
      bookMetrics: {
        bidAskRatio: bidDepth1pct / (askDepth1pct || 1),
        bidWallPrice,
        bidWallSize,
        askWallPrice,
        askWallSize,
        imbalance: bidDepth1pct > askDepth1pct * 1.5
          ? 'bid-heavy'
          : askDepth1pct > bidDepth1pct * 1.5
            ? 'ask-heavy'
            : 'neutral',
      },
      candleMetrics: {
        trend1m: trend(mtf.timeframes['1m'] || []),
        trend15m: trend(mtf.timeframes['15m'] || []),
        volumeProfile: volProfile(mtf.timeframes['1m'] || []),
      },
      tradeMetrics: this.trades?.metrics(pair) ?? undefined,
      microstructure: computeMicrostructureMetrics({
        pair,
        top,
        tradeFlow: this.trades,
        nowMs,
      }),
      intraday: computeIntradayIndicators({
        pair,
        candles1m: mtf.timeframes['1m'] || [],
        candles15m: mtf.timeframes['15m'] || [],
        tradeFlow: this.trades,
        nowMs,
      }),
      swing,
      ...(liquidityRaid ? { liquidityRaid } : {}),
      generatedAt: nowMs,
    };
  }

  getLatest(pair: string): FusionSnapshot | null {
    return this.latestFusion.get(pair) || null;
  }

  private recordSwingHistory(pair: string, ltp: FusionSnapshot['ltp'], nowMs: number): void {
    const price = ltp.markPrice || ltp.price;
    if (!Number.isFinite(price) || price <= 0) return;
    const history = this.swingHistoryByPair.get(pair) ?? [];
    const point: SwingHistoryPoint = {
      ts: nowMs,
      price,
      ...(ltp.openInterest !== undefined ? { openInterest: ltp.openInterest } : {}),
      ...(ltp.basis !== undefined ? { basis: ltp.basis } : {}),
      ...(ltp.syntheticFundingRate !== undefined
        ? { syntheticFundingRate: ltp.syntheticFundingRate }
        : {}),
    };
    history.push(point);
    if (history.length > this.swingHistoryLimit) {
      history.splice(0, history.length - this.swingHistoryLimit);
    }
    this.swingHistoryByPair.set(pair, history);
  }
}
