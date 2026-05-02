import { EventEmitter } from 'events';
import { MultiTimeframeStore, type MtfSnapshot } from './multi-timeframe-store';
import { BookManager } from './book/book-manager';
import type { Candle } from '../ai/state-builder';
import type { AppLogger } from '../logging/logger';

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
  generatedAt: number;
}

export class CoinDcxFusion extends EventEmitter {
  private ltpState = new Map<string, FusionSnapshot['ltp']>();
  private latestFusion = new Map<string, FusionSnapshot>();

  constructor(
    private logger: AppLogger,
    private ws: EventEmitter,
    private mtf: MultiTimeframeStore,
    private books: BookManager
  ) {
    super();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // LTP from ticker or currentPrices
    this.ws.on('currentPrices@futures#update', (data: any) => {
      const prices = data.prices || data;
      if (!prices || typeof prices !== 'object') return;

      Object.entries(prices).forEach(([pair, info]: [string, any]) => {
        if (!info || typeof info !== 'object') return;
        this.ltpState.set(pair, {
          price: parseFloat(info.ls || info.mp || '0'),
          bid: parseFloat(info.b || '0'), // Some feeds might have bid/ask
          ask: parseFloat(info.a || '0'),
          markPrice: parseFloat(info.mp || '0'),
          volume24h: parseFloat(info.v || '0'),
          change24h: parseFloat(info.pc || '0'),
        });
        this.maybeGenerateFusion(pair);
      });
    });

    // We can also listen to depth updates from ws if we want to trigger on every tick,
    // but maybe it's better to trigger on ltp or candle updates.
    this.ws.on('depth-update', (data: any) => {
      if (data?.s) this.maybeGenerateFusion(data.s);
    });

    this.mtf.on('update', ({ pair }) => {
      this.maybeGenerateFusion(pair);
    });
  }

  private maybeGenerateFusion(pair: string): void {
    const book = this.books.get(pair);
    const ltp = this.ltpState.get(pair);
    const mtfSnap = this.mtf.getSnapshot(pair);

    if (!book || !ltp || !mtfSnap) return;

    const snapshot = this.buildFusion(pair, book, ltp, mtfSnap);
    this.latestFusion.set(pair, snapshot);
    this.emit('fusion', snapshot);
  }

  private buildFusion(
    pair: string,
    book: import('./book/orderbook').OrderBook,
    ltp: FusionSnapshot['ltp'],
    mtf: MtfSnapshot
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
    const bidWall = top.bids.reduce((max, b) => parseFloat(b.qty) > parseFloat(max.qty) ? b : max, top.bids[0] || { price: '0', qty: '0' });
    const askWall = top.asks.reduce((max, a) => parseFloat(a.qty) > parseFloat(max.qty) ? a : max, top.asks[0] || { price: '0', qty: '0' });

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

    return {
      pair,
      l2: {
        pair,
        bestBid,
        bestAsk,
        spread,
        bidDepth: bidDepth1pct,
        askDepth: askDepth1pct,
        timestamp: Date.now(),
      },
      ltp,
      candles: mtf.timeframes,
      bookMetrics: {
        bidAskRatio: bidDepth1pct / (askDepth1pct || 1),
        bidWallPrice: parseFloat(bidWall.price),
        bidWallSize: parseFloat(bidWall.qty),
        askWallPrice: parseFloat(askWall.price),
        askWallSize: parseFloat(askWall.qty),
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
      generatedAt: Date.now(),
    };
  }

  getLatest(pair: string): FusionSnapshot | null {
    return this.latestFusion.get(pair) || null;
  }
}
