In trading can you explain from scratch to how price changes

I'll explain how price changes work in trading from the ground up, covering both the mechanics and the underlying forces.
The Foundation: What Is a "Price"?
A price is simply the most recent transaction value — the last point where a buyer and seller agreed to exchange an asset. It is not an intrinsic truth; it is a snapshot of consensus at a specific moment.
The Two Core Forces: Supply & Demand
Every price change originates from the imbalance between:
Table
Force What It Means Effect on Price
Demand (Buyers) Want to acquire the asset Pushes price up
Supply (Sellers) Want to dispose of the asset Pushes price down
When buyers are more eager than sellers, prices rise. When sellers are more desperate than buyers, prices fall. When they're equally matched, price stalls.
The Mechanism: Order Books & Matching
Modern markets use an order book — a real-time list of all pending buy and sell orders:
plain
Copy
BIDS (Buyers willing to pay)          ASKS (Sellers willing to accept)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
$100.00 — 500 shares                  $100.05 — 200 shares
$99.95  — 300 shares                  $100.10 — 800 shares
$99.90  — 1,000 shares                $100.15 — 400 shares
The spread ($100.00 vs $100.05) is the gap between the highest buyer and lowest seller. No trade happens until someone crosses this gap.
How a Price Change Occurs
Scenario: Price rises to $100.05
A new buyer enters, unwilling to wait. They place a "market order" to buy immediately.
They accept the lowest ask: $100.05.
The last traded price is now $100.05. Price has "moved up" 5 cents.
Scenario: Price drops to $99.95
A seller wants out now. They hit the highest bid at $99.95.
The last traded price is now $99.95. Price has dropped.
Key insight: A single transaction changes the "price." No transaction, no price change.
Types of Orders & Their Impact
Table
Order Type Behavior Price Impact
Market Order Execute immediately at best available price Consumes liquidity, often moves price
Limit Order Execute only at specified price or better Adds liquidity, sits in order book
Stop Order Triggers market order when price hits threshold Can accelerate moves (cascading effect)
What Actually Causes the Imbalance?
Beyond simple supply/demand, several engines drive the shifts:

1. Information & Expectations
New data (earnings reports, economic numbers, geopolitical events) changes what people believe the asset is worth.
Prices move before the fact is fully known, as traders anticipate.
2. Liquidity Conditions
Thin markets (few participants): Small orders move prices dramatically.
Deep markets (many participants): Large orders absorb with minimal impact.
3. Market Structure Effects
Algorithmic trading: Programs react in milliseconds to signals, amplifying moves.
Derivatives linkage: Options expirations, futures arbitrage, and forced hedging create feedback loops.
4. Behavioral Factors
Fear & greed: Herding causes overshooting.
Anchoring: Traders fixate on round numbers or past prices, creating support/resistance.
Loss aversion: Sellers hold losers too long, then panic; buyers chase winners.
A Concrete Example
Imagine a stock trading at $50.00:
Table
Time Event Order Book Action New Price
9:30 Company announces 50% profit jump Flood of buy orders hits asks $50.50
9:31 Buyers exhaust near-term asks Next ask at $51.00 taken $51.00
9:32 Short sellers cover (buy to close) More buying pressure $52.00
9:35 Algorithm detects momentum Automated buying kicks in $53.50
10:00 Early buyers take profits Sell orders absorb bids $52.20
The price is a trail of transactions, each one a decision made by someone with a different reason, timeframe, and risk tolerance.
Summary
Price changes are not mysterious. They are the visible output of a continuous auction where:
Buyers and sellers negotiate through orders. When one side becomes more aggressive or numerous than the other, the last transaction price shifts. That shift is what we call "the price moving."
The "why" behind the aggression — whether it's a news event, a fund rebalancing, or a tweet — is what makes markets complex. But the "how" is mechanical: orders matched, one at a time, each setting a new reference point.
Om which side the vol should be high so the price moves up higher?

Looking at your SOL order book screenshot, here's the direct answer:
For Price to Move Up: Bid Side (Left/Green) Should Be High
Table
Side Color What It Means Effect on Price
Bid 🟢 Green Buyers saying "I want to buy at this price" High bid volume = buying pressure = price moves up
Ask 🔴 Red Sellers saying "I want to sell at this price" High ask volume = selling pressure = price moves down
Why? The Mechanics
In your screenshot, the best bid is 84.00 and the best ask is 84.07 — a 7-cent spread.
For price to rise past 84.07, one of two things must happen:
A buyer gets impatient and places a market order (or limit at 84.07+), eating the ask
Bids stack up so thick that sellers see strong demand and raise their ask prices
High bid volume = confidence. It signals:
"There are many buyers waiting; don't sell cheap"
Sellers may cancel lower asks and re-list higher
The market has absorption capacity on the way down (support)
What You're Seeing in Your Book
Table
Observation Reading
Massive 5,047 SOL at 84.00 bid Strong support — buyers defending this level
Large 7,407 SOL at 84.08 ask Resistance — sellers clustered just above current price
84.07 mark price Trapped between these two walls
For a breakout above 84.08, you'd want to see:
Bid volume increasing at 84.06–84.07 (buyers stepping up)
Ask volume at 84.08 getting eaten (aggressive buying)
Or a large market buy that sweeps through 84.08, 84.09, 84.10...
The Key Principle
Price moves toward the side that is being consumed.
If bids are high and growing → sellers have to meet them → price rises
If asks are high and growing → buyers have to meet them → price falls
Volume alone isn't enough — you need imbalance. A wall of bids with no asks above it = rocket. A wall of asks with no bids below it = collapse.
In your case, watch if that 5,047 SOL bid at 84.00 holds or if the 7,407 SOL ask at 84.08 breaks first. Whichever side absorbs the other dictates the next move.
How can we analyse the bid/ask this data and the ohlcv data to identify where the price is going or wants to go

Great question — combining order book depth (bid/ask) with OHLCV (price history) gives you a much clearer picture than either alone. Here's how to fuse them.
What Each Dataset Tells You
Table
Data Timeframe What It Reveals
Order Book Real-time (milliseconds) Intent — who wants to do what, right now
OHLCV Historical (minutes/days) Action — what actually happened, and the result
OHLCV shows you the trail. The order book shows you the terrain ahead.
The Core Idea: Intent vs. Confirmation
Order book = leading indicator. OHLCV = lagging indicator.
You use the order book to predict where pressure is building, and OHLCV to confirm whether that pressure is translating into real moves.
Practical Analysis Framework

1. Spotting Absorption & Reversal Zones
Table
Order Book Signal OHLCV Confirmation Interpretation
Large bid wall at support level + price touches it Candle bounces with high volume Support is real — buyers are absorbing selling
Large bid wall + price slices through it on low volume Small candle, weak volume "Fake" wall — likely spoofing or icebergs, support will break
Ask wall at resistance + price stalls there Multiple wicks, declining volume Sellers in control — breakout unlikely
Ask wall gets eaten rapidly Big green candle, volume spike Breakout brewing — aggressive buying
Key rule: Volume validates the book. A thick wall without volume behind the touch is suspicious.
2. Reading the Spread + Recent Candles
Combine the current spread with the last 3-5 candles:
Table
Scenario Order Book Last OHLCV Candles Probable Move
A Tight spread, bids stacking Higher highs, increasing volume Continuation up — momentum aligned
B Wide spread, thin bids below Lower lows, volume fading Downside acceleration — no support
C Spread widening, both sides thinning Doji/small body, low volume Indecision — big move coming, direction unclear
D Bids pulled, asks suddenly thicken Long upper wick, volume spike Distribution — smart money selling into strength
3. Cumulative Volume Delta (CVD) from OHLCV + Book
Track where volume traded relative to bid/ask:
If price closed near the high of the candle with high volume, but the order book now shows thick asks above → exhaustion. Buyers spent their ammo; sellers waiting.
If price closed near the low with high volume, but bids are reloading below → capitulation + accumulation. Sellers exhausted; buyers preparing.
4. Specific Techniques
a) Support/Resistance Validation
plain
Copy
OHLCV: Previous low at $50, tested 3 times, held.
Order Book: Now at $50, 10,000 unit bid wall vs 2,000 ask.
→ High probability bounce. The book confirms the historical level.
b) Breakout Confirmation
plain
Copy
OHLCV: Price consolidating under $60 resistance for 5 days.
Order Book: Asks at $60 suddenly disappearing, bids thickening at $59.80.
→ Breakout likely. The book shows supply drying up before the candle does.
c) Fakeout Detection
plain
Copy
OHLCV: Big green candle breaks $70 resistance.
Order Book: Asks immediately reload above $70, bids pull back, spread widens.
→ Likely false breakout. Book shows no real follow-through demand.
Applying This to Your SOL Screenshot
From your image:
Mark price: 84.07
Key bid wall: 5,047 SOL at 84.00 (strong support)
Key ask wall: 7,407 SOL at 84.08 (resistance)
What to watch in OHLCV:
Table
If you see this in recent candles... Interpretation
Price hovering 84.00–84.10, volume declining Consolidation — waiting for a catalyst
Wick down to ~84.00, immediate bounce, volume spike on recovery Support validated — bid wall is absorbing
Price pushes to 84.08, stalls, upper wicks form Resistance holding — 7,407 SOL ask is real
Volume spikes as price breaks 84.08 with momentum Breakout — ask wall getting consumed
Summary: The Decision Matrix
Table
Order Book Pressure OHLCV Trend Your Bias
Bids > Asks (thick left side) Higher highs, ↑ volume Bullish — follow the move
Bids > Asks Lower highs, ↓ volume Cautious bullish — weak momentum, watch for reversal
Asks > Bids (thick right side) Lower lows, ↑ volume Bearish — follow the move
Asks > Bids Higher lows, ↓ volume Cautious bearish — potential bottom forming
Balanced, both sides thick Range-bound, low volume Neutral — wait for imbalance
Both sides thinning Volatility compression (Bollinger squeeze) Explosive move imminent — prepare, don't predict
One Final Rule
The order book tells you where the battle is. OHLCV tells you who is winning.
Never trade the book alone — spoofing and hidden orders can fake walls. Never trade OHLCV alone — it only shows what already happened. Together, they give you location + momentum, which is as close to an edge as structure provides.
If we are using this
<https://docs.coindcx.com/?javascript> for multitimeframe ohlcv data and ws for LTP and the bid ask data
How can we integrate this into a bot I already have <https://github.com/shubhamtaywade82/coindcx-bot> which is built using node and TUI LAYOUTS

I'll help you integrate CoinDCX's multi-timeframe OHLCV and real-time WebSocket data (LTP + order book) into your existing Node.js TUI bot. Let me first examine your current repository structure and the CoinDCX API documentation.
Fetch URLs

1 pages
Let me also check your GitHub repository to understand your existing bot structure.
Fetch URLs

1 pages
Excellent — your bot is already a sophisticated, production-grade system with L2 order book management, a strategy framework, backtester, risk filters, and a TUI. Let me design the integration architecture that fits cleanly into your existing codebase.
Integration Architecture
Your bot already has the right abstractions. We just need to wire CoinDCX's REST + WS feeds into your existing BookManager, CandleSource, and Strategy contracts.
plain
Copy
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOUR EXISTING BOT                              │
├─────────────────────────────────────────────────────────────────────────┤
│  TUI v2 (blessed)                                                       │
│    ├── Signals Panel ←── SignalBus.emit('strategy.long'|'short'|'wait') │
│    ├── Risk Panel    ←── CompositeRiskFilter                            │
│    ├── Book Panel    ←── L2 OrderBook (already exists)                  │
│    └── OHLCV Panel   ←── NEW: Multi-timeframe candle display            │
│                                                                          │
│  Strategy Framework (SmcRule, MaCross, LlmPulse)                      │
│    └── needs: { l2Snapshot, candles: { '1m': [...], '15m': [...] } }   │
│                                                                          │
│  BookManager + ResyncOrchestrator (already handles WS/REST fallback)      │
│  StaleWatcher + Heartbeat (already exists)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                         NEW: COINDCX DATA LAYER                          │
├─────────────────────────────────────────────────────────────────────────┤
│  CoinDcxWsClient ──► BookManager (L2 updates)                         │
│       │                                                                  │
│       └──► LtpFeed ──► Strategy (tick-level triggers)                   │
│                                                                          │
│  CoinDcxRestClient ──► CandleSource                                     │
│       ├── GET /market_data/candles?pair=X&interval=1m                   │
│       ├── GET /market_data/candles?pair=X&interval=15m                  │
│       └── GET /market_data/orderbook?pair=X (REST fallback)               │
│                                                                          │
│  CoinDcxDataFusion ──► Strategy input object                            │
│       (merges l2 + multi-tf candles + ltp into single snapshot)         │
└─────────────────────────────────────────────────────────────────────────┘

1. CoinDCX REST Client (Multi-timeframe OHLCV)
Add to src/data/coincdx-rest-client.ts (or equivalent in your structure):
TypeScript
Copy
// src/data/coincdx-rest-client.ts
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

const CandleSchema = z.object({
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  time: z.number(), // ms timestamp
});

export type CoinDcxCandle = z.infer<typeof CandleSchema>;

const VALID_INTERVALS = [
  '1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '1d', '3d', '1w', '1M'
] as const;

export class CoinDcxRestClient {
  private http: AxiosInstance;
  private readonly baseUrl = '<https://public.coindcx.com>';

  constructor() {
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });
  }

  /**

* Fetch OHLCV candles for a specific pair and interval.
* CoinDCX returns descending order (newest first). We reverse to chronological.
   */
  async getCandles(
    pair: string,
    interval: typeof VALID_INTERVALS[number],
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<CoinDcxCandle[]> {
    const params = new URLSearchParams({
      pair,
      interval,
      ...(options?.startTime && { startTime: String(options.startTime) }),
      ...(options?.endTime && { endTime: String(options.endTime) }),
      ...(options?.limit && { limit: String(Math.min(options.limit, 1000)) }),
    });

    const { data } = await this.http.get(`/market_data/candles?${params.toString()}`);
    const parsed = z.array(CandleSchema).safeParse(data);

    if (!parsed.success) {
      throw new Error(`Candle parse failed: ${parsed.error.message}`);
    }

    // Reverse to chronological order (oldest first) for strategy consumption
    return parsed.data.reverse();
  }

  /**

* Fetch current L2 order book snapshot (REST fallback).
   */
  async getOrderBook(pair: string): Promise<{ bids: Record<string, string>; asks: Record<string, string> }> {
    const { data } = await this.http.get(`/market_data/orderbook?pair=${pair}`);
    return data;
  }

  /**

* Fetch recent trades (for CVD / volume delta analysis).
   */
  async getTrades(pair: string, limit = 50): Promise<Array<{
    p: number; q: number; s: string; T: number; m: boolean;
  }>> {
    const { data } = await this.http.get(`/market_data/trade_history?pair=${pair}&limit=${limit}`);
    return data;
  }
}

1. Multi-timeframe Candle Manager
Add to src/data/multi-timeframe-store.ts. This feeds your strategy framework:
TypeScript
Copy
// src/data/multi-timeframe-store.ts
import EventEmitter from 'events';
import { CoinDcxRestClient, CoinDcxCandle } from './coincdx-rest-client';
import { logger } from '../utils/logger';

export interface TimeframeConfig {
  interval: string;
  historyLength: number;   // how many candles to keep
  refreshMs: number;       // poll interval
}

export interface MtfSnapshot {
  pair: string;
  timeframes: Record<string, CoinDcxCandle[]>;
  lastUpdatedAt: number;
}

export class MultiTimeframeStore extends EventEmitter {
  private client: CoinDcxRestClient;
  private stores = new Map<string, Map<string, CoinDcxCandle[]>>(); // pair -> tf -> candles
  private timers = new Map<string, NodeJS.Timer>();
  private readonly config: TimeframeConfig[];

  constructor(
    client: CoinDcxRestClient,
    config: TimeframeConfig[] = [
      { interval: '1m', historyLength: 100, refreshMs: 30000 },
      { interval: '15m', historyLength: 50, refreshMs: 60000 },
      { interval: '1h', historyLength: 24, refreshMs: 300000 },
    ]
  ) {
    super();
    this.client = client;
    this.config = config;
  }

  async subscribe(pair: string): Promise<void> {
    if (this.timers.has(pair)) return;

    // Initialize all timeframes
    const tfMap = new Map<string, CoinDcxCandle[]>();
    for (const tf of this.config) {
      try {
        const candles = await this.client.getCandles(pair, tf.interval as any, {
          limit: tf.historyLength,
        });
        tfMap.set(tf.interval, candles);
        logger.info({ pair, interval: tf.interval, count: candles.length }, 'MTF seeded');
      } catch (err) {
        logger.error({ pair, interval: tf.interval, err }, 'MTF seed failed');
        throw err;
      }
    }
    this.stores.set(pair, tfMap);

    // Start polling loops per timeframe
    for (const tf of this.config) {
      const timer = setInterval(async () => {
        try {
          const latest = await this.client.getCandles(pair, tf.interval as any, { limit: 2 });
          this.mergeCandles(pair, tf.interval, latest.reverse(), tf.historyLength);
        } catch (err) {
          logger.warn({ pair, interval: tf.interval, err }, 'MTF poll failed');
        }
      }, tf.refreshMs);
      this.timers.set(`${pair}:${tf.interval}`, timer);
    }

    this.emit('subscribed', pair);
  }

  private mergeCandles(pair: string, interval: string, incoming: CoinDcxCandle[], maxLen: number) {
    const tfMap = this.stores.get(pair);
    if (!tfMap) return;

    const existing = tfMap.get(interval) || [];
    const merged = [...existing];

    for (const candle of incoming) {
      const last = merged[merged.length - 1];
      if (last && last.time === candle.time) {
        // Update in-place (newer data)
        merged[merged.length - 1] = candle;
      } else if (!last || candle.time > last.time) {
        merged.push(candle);
      }
    }

    // Trim to max length
    if (merged.length > maxLen) merged.splice(0, merged.length - maxLen);

    tfMap.set(interval, merged);
    this.emit('update', { pair, interval, candle: merged[merged.length - 1] });
  }

  getSnapshot(pair: string): MtfSnapshot | null {
    const tfMap = this.stores.get(pair);
    if (!tfMap) return null;

    const timeframes: Record<string, CoinDcxCandle[]> = {};
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
3. WebSocket Client (LTP + Order Book)
CoinDCX uses Socket.IO v2.4.0. Add to src/data/coincdx-ws-client.ts:
TypeScript
Copy
// src/data/coincdx-ws-client.ts
import io from 'socket.io-client';
import EventEmitter from 'events';
import { logger } from '../utils/logger';

/**

* CoinDCX public WebSocket for real-time L2 order book + LTP + trades.
* Socket.IO v2.4.0 required per their docs.
 */
export class CoinDcxWsClient extends EventEmitter {
  private socket: SocketIOClient.Socket | null = null;
  private readonly url = 'wss://stream.coindcx.com';
  private subscribedPairs = new Set<string>();
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly heartbeatIntervalMs = 25000;

  connect(): void {
    this.socket = io(this.url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this.socket.on('connect', () => {
      logger.info('CoinDCX WS connected');
      this.emit('connected');
      // Resubscribe to all previously active pairs
      for (const pair of this.subscribedPairs) {
        this.subscribePair(pair);
      }
      this.startHeartbeat();
    });

    this.socket.on('disconnect', (reason: string) => {
      logger.warn({ reason }, 'CoinDCX WS disconnected');
      this.emit('disconnected', reason);
      this.stopHeartbeat();
    });

    // L2 Order Book updates
    this.socket.on('depth-update', (data: {
      pair: string;
      bids: [string, string][]; // [price, quantity]
      asks: [string, string][];
      timestamp: number;
    }) => {
      this.emit('l2-update', {
        pair: data.pair,
        bids: Object.fromEntries(data.bids),
        asks: Object.fromEntries(data.asks),
        timestamp: data.timestamp,
      });
    });

    // Last Traded Price (LTP)
    this.socket.on('ticker', (data: {
      pair: string;
      last_price: string;
      bid: string;
      ask: string;
      volume: string;
      change_24_hour: string;
      timestamp: number;
    }) => {
      this.emit('ltp', {
        pair: data.pair,
        lastPrice: parseFloat(data.last_price),
        bid: parseFloat(data.bid),
        ask: parseFloat(data.ask),
        volume24h: parseFloat(data.volume),
        change24h: parseFloat(data.change_24_hour),
        timestamp: data.timestamp,
      });
    });

    // Recent trades (for CVD)
    this.socket.on('trade', (data: {
      pair: string;
      price: string;
      quantity: string;
      side: 'buy' | 'sell';
      timestamp: number;
    }) => {
      this.emit('trade', {
        pair: data.pair,
        price: parseFloat(data.price),
        quantity: parseFloat(data.quantity),
        side: data.side,
        timestamp: data.timestamp,
      });
    });

    this.socket.on('error', (err: Error) => {
      logger.error({ err }, 'CoinDCX WS error');
      this.emit('error', err);
    });
  }

  subscribePair(pair: string): void {
    this.subscribedPairs.add(pair);
    if (this.socket?.connected) {
      this.socket.emit('join', { pair });
      logger.info({ pair }, 'Subscribed to pair');
    }
  }

  unsubscribePair(pair: string): void {
    this.subscribedPairs.delete(pair);
    if (this.socket?.connected) {
      this.socket.emit('leave', { pair });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.socket?.emit('ping');
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this.socket = null;
  }
}

4. Data Fusion Engine (Strategy Input)
This is the bridge. Your SmcRule / MaCross / LlmPulse strategies expect a unified input object:
TypeScript
Copy
// src/data/coincdx-fusion.ts
import EventEmitter from 'events';
import { CoinDcxWsClient } from './coincdx-ws-client';
import { MultiTimeframeStore, MtfSnapshot } from './multi-timeframe-store';
import { CoinDcxRestClient } from './coincdx-rest-client';
import { logger } from '../utils/logger';

export interface L2Snapshot {
  pair: string;
  bids: Record<string, string>;  // price -> qty
  asks: Record<string, string>;
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
    volume24h: number;
    change24h: number;
  };
  candles: MtfSnapshot['timeframes'];
  // Computed order book metrics
  bookMetrics: {
    bidAskRatio: number;      // bidDepth / askDepth
    bidWallPrice: number | null;
    bidWallSize: number;
    askWallPrice: number | null;
    askWallSize: number;
    imbalance: 'bid-heavy' | 'ask-heavy' | 'neutral';
  };
  // Computed candle metrics
  candleMetrics: {
    trend1m: 'up' | 'down' | 'sideways';
    trend15m: 'up' | 'down' | 'sideways';
    volumeProfile: 'increasing' | 'decreasing' | 'flat';
    rsi1m?: number;  // if you compute it
  };
  generatedAt: number;
}

export class CoinDcxFusion extends EventEmitter {
  private ws: CoinDcxWsClient;
  private mtf: MultiTimeframeStore;
  private rest: CoinDcxRestClient;

  private l2State = new Map<string, { bids: Map<string, string>; asks: Map<string, string> }>();
  private ltpState = new Map<string, FusionSnapshot['ltp']>();
  private latestFusion = new Map<string, FusionSnapshot>();

  constructor(ws: CoinDcxWsClient, mtf: MultiTimeframeStore, rest: CoinDcxRestClient) {
    super();
    this.ws = ws;
    this.mtf = mtf;
    this.rest = rest;

    this.setupWsHandlers();
    this.setupMtfHandlers();
  }

  private setupWsHandlers(): void {
    this.ws.on('l2-update', ({ pair, bids, asks, timestamp }) => {
      let state = this.l2State.get(pair);
      if (!state) {
        state = { bids: new Map(), asks: new Map() };
        this.l2State.set(pair, state);
      }

      // Apply delta updates
      for (const [price, qty] of Object.entries(bids)) {
        if (parseFloat(qty) === 0) state.bids.delete(price);
        else state.bids.set(price, qty);
      }
      for (const [price, qty] of Object.entries(asks)) {
        if (parseFloat(qty) === 0) state.asks.delete(price);
        else state.asks.set(price, qty);
      }

      this.emit('l2-raw', { pair, timestamp });
      this.maybeGenerateFusion(pair);
    });

    this.ws.on('ltp', (data) => {
      this.ltpState.set(data.pair, data);
      this.maybeGenerateFusion(data.pair);
    });
  }

  private setupMtfHandlers(): void {
    this.mtf.on('update', ({ pair }) => {
      this.maybeGenerateFusion(pair);
    });
  }

  private maybeGenerateFusion(pair: string): void {
    const l2 = this.l2State.get(pair);
    const ltp = this.ltpState.get(pair);
    const mtfSnap = this.mtf.getSnapshot(pair);

    if (!l2 || !ltp || !mtfSnap) return; // Wait for all data sources

    const snapshot = this.buildFusion(pair, l2, ltp, mtfSnap);
    this.latestFusion.set(pair, snapshot);
    this.emit('fusion', snapshot);
  }

  private buildFusion(
    pair: string,
    l2: { bids: Map<string, string>; asks: Map<string, string> },
    ltp: FusionSnapshot['ltp'],
    mtf: MtfSnapshot
  ): FusionSnapshot {
    // Sort and slice top 20 levels
    const sortedBids = Array.from(l2.bids.entries())
      .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 20);

    const sortedAsks = Array.from(l2.asks.entries())
      .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 20);

    const bestBid = sortedBids[0]?.price || 0;
    const bestAsk = sortedAsks[0]?.price || 0;
    const spread = bestAsk - bestBid;

    // Depth within 1% of best price
    const bidDepth1pct = sortedBids
      .filter(b => b.price >= bestBid * 0.99)
      .reduce((sum, b) => sum + b.qty, 0);
    const askDepth1pct = sortedAsks
      .filter(a => a.price <= bestAsk * 1.01)
      .reduce((sum, a) => sum + a.qty, 0);

    // Find walls (largest single level)
    const bidWall = sortedBids.reduce((max, b) => b.qty > max.qty ? b : max, sortedBids[0] || { price: 0, qty: 0 });
    const askWall = sortedAsks.reduce((max, a) => a.qty > max.qty ? a : max, sortedAsks[0] || { price: 0, qty: 0 });

    // Candle trend analysis
    const trend = (candles: typeof mtf.timeframes[string]): 'up' | 'down' | 'sideways' => {
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

    const volProfile = (candles: typeof mtf.timeframes[string]): 'increasing' | 'decreasing' | 'flat' => {
      if (candles.length < 5) return 'flat';
      const avgRecent = candles.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
      const avgPrev = candles.slice(-6, -3).reduce((s, c) => s + c.volume, 0) / 3;
      const ratio = avgRecent / avgPrev;
      if (ratio > 1.2) return 'increasing';
      if (ratio < 0.8) return 'decreasing';
      return 'flat';
    };

    return {
      pair,
      l2: {
        pair,
        bids: Object.fromEntries(l2.bids),
        asks: Object.fromEntries(l2.asks),
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
        bidWallPrice: bidWall.qty > 0 ? bidWall.price : null,
        bidWallSize: bidWall.qty,
        askWallPrice: askWall.qty > 0 ? askWall.price : null,
        askWallSize: askWall.qty,
        imbalance: bidDepth1pct > askDepth1pct * 1.2
          ? 'bid-heavy'
          : askDepth1pct > bidDepth1pct * 1.2
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
5. Strategy Adapter
Your existing Strategy interface likely takes some input. Modify the contract to accept FusionSnapshot:
TypeScript
Copy
// src/strategy/types.ts (extend existing)
import { FusionSnapshot } from '../data/coincdx-fusion';

export interface StrategyInput {
  fusion: FusionSnapshot;
  // Keep backward compat if needed:
  // legacy?: any;
}

export interface Strategy {
  id: string;
  onTick(input: StrategyInput): StrategySignal;
}

export type StrategySignal =
  | { action: 'long'; confidence: number; reason: string; metadata?: Record<string, unknown> }
  | { action: 'short'; confidence: number; reason: string; metadata?: Record<string, unknown> }
  | { action: 'wait'; reason: string }
  | { action: 'error'; reason: string };
Example: SmcRule using order book + OHLCV fusion:
TypeScript
Copy
// src/strategy/smc-rule-fused.ts
import { Strategy, StrategyInput, StrategySignal } from './types';
import { logger } from '../utils/logger';

export class SmcRuleFused implements Strategy {
  readonly id = 'smc-fused';

  onTick(input: StrategyInput): StrategySignal {
    const { fusion } = input;
    const { l2, bookMetrics, candleMetrics, candles } = fusion;

    // --- SMC Logic: Order Block + Imbalance Detection ---

    // 1. Check for bid-heavy book + 1m uptrend (accumulation)
    if (bookMetrics.imbalance === 'bid-heavy' && candleMetrics.trend1m === 'up') {
      // 2. Verify 15m higher timeframe alignment
      if (candleMetrics.trend15m === 'up' || candleMetrics.trend15m === 'sideways') {
        // 3. Check if price is near bid wall (support)
        const proximityToWall = Math.abs(l2.bestBid - (bookMetrics.bidWallPrice || 0)) / l2.bestBid;
        if (proximityToWall < 0.001) { // within 0.1%
          return {
            action: 'long',
            confidence: 0.72,
            reason: `Bid wall at ${bookMetrics.bidWallPrice} holding + HTF ${candleMetrics.trend15m} + LTF momentum`,
            metadata: {
              bidWallSize: bookMetrics.bidWallSize,
              bidAskRatio: bookMetrics.bidAskRatio,
              ltfTrend: candleMetrics.trend1m,
            },
          };
        }
      }
    }

    // Bearish mirror
    if (bookMetrics.imbalance === 'ask-heavy' && candleMetrics.trend1m === 'down') {
      if (candleMetrics.trend15m === 'down' || candleMetrics.trend15m === 'sideways') {
        const proximityToWall = Math.abs(l2.bestAsk - (bookMetrics.askWallPrice || 0)) / l2.bestAsk;
        if (proximityToWall < 0.001) {
          return {
            action: 'short',
            confidence: 0.68,
            reason: `Ask wall at ${bookMetrics.askWallPrice} capping + HTF ${candleMetrics.trend15m}`,
            metadata: {
              askWallSize: bookMetrics.askWallSize,
              bidAskRatio: bookMetrics.bidAskRatio,
            },
          };
        }
      }
    }

    return {
      action: 'wait',
      reason: `Book: ${bookMetrics.imbalance}, 1m: ${candleMetrics.trend1m}, 15m: ${candleMetrics.trend15m}`,
    };
  }
}
6. TUI Integration
Your TUI v2 already has panels. Wire the new data into them:
TypeScript
Copy
// In your TUI setup / main loop
const fusion = fusionEngine.getLatest(pair);
if (fusion) {
  // Book panel (existing) — now enriched with wall data
  bookPanel.setData({
    bids: fusion.l2.bids,
    asks: fusion.l2.asks,
    bestBid: fusion.l2.bestBid,
    bestAsk: fusion.l2.bestAsk,
    bidWall: { price: fusion.bookMetrics.bidWallPrice, size: fusion.bookMetrics.bidWallSize },
    askWall: { price: fusion.bookMetrics.askWallPrice, size: fusion.bookMetrics.askWallSize },
    imbalance: fusion.bookMetrics.imbalance,
  });

  // NEW: OHLCV panel
  ohlcvPanel.setData({
    timeframes: Object.entries(fusion.candles).map(([tf, candles]) => ({
      interval: tf,
      latest: candles[candles.length - 1],
      trend: fusion.candleMetrics[`trend${tf}` as keyof typeof fusion.candleMetrics] || 'sideways',
    })),
    volumeProfile: fusion.candleMetrics.volumeProfile,
  });

  // Signals panel (existing) — now driven by fused strategy
  const signal = strategy.onTick({ fusion });
  if (signal.action === 'long' || signal.action === 'short') {
    signalBus.emit(`strategy.${signal.action}`, {
      pair,
      strategy: strategy.id,
      confidence: signal.confidence,
      reason: signal.reason,
      metadata: signal.metadata,
    });
  }
}
7. Wiring It All Together (Main Entry)
TypeScript
Copy
// src/main.ts (or your existing entry point)
import { CoinDcxRestClient } from './data/coincdx-rest-client';
import { CoinDcxWsClient } from './data/coincdx-ws-client';
import { MultiTimeframeStore } from './data/multi-timeframe-store';
import { CoinDcxFusion } from './data/coincdx-fusion';
import { SmcRuleFused } from './strategy/smc-rule-fused';
import { CompositeRiskFilter } from './risk/composite-filter';
import { SignalBus } from './signals/bus';
import { TuiV2 } from './tui/v2';

async function main() {
  const pair = 'B-SOL_USDT'; // Your SOL pair

  // 1. Initialize data layer
  const rest = new CoinDcxRestClient();
  const ws = new CoinDcxWsClient();
  const mtf = new MultiTimeframeStore(rest, [
    { interval: '1m', historyLength: 100, refreshMs: 30000 },
    { interval: '15m', historyLength: 50, refreshMs: 60000 },
    { interval: '1h', historyLength: 24, refreshMs: 300000 },
  ]);
  const fusion = new CoinDcxFusion(ws, mtf, rest);

  // 2. Initialize strategy + risk
  const strategy = new SmcRuleFused();
  const riskFilter = new CompositeRiskFilter(); // your existing
  const signalBus = new SignalBus(); // your existing

  // 3. Initialize TUI
  const tui = new TuiV2({ signalBus, riskFilter });

  // 4. Wire fusion → strategy → risk → signals → TUI
  fusion.on('fusion', (snap) => {
    const signal = strategy.onTick({ fusion: snap });

    if (signal.action === 'long' || signal.action === 'short') {
      const riskResult = riskFilter.evaluate({
        pair: snap.pair,
        side: signal.action,
        confidence: signal.confidence,
        strategy: strategy.id,
      });

      if (riskResult.allowed) {
        signalBus.emit(`strategy.${signal.action}`, {
          pair: snap.pair,
          strategy: strategy.id,
          confidence: signal.confidence,
          reason: signal.reason,
          metadata: signal.metadata,
        });
      } else {
        signalBus.emit('risk.blocked', {
          pair: snap.pair,
          strategy: strategy.id,
          reason: riskResult.reason,
        });
      }
    }

    // Update TUI with latest data
    tui.updateBook(snap.l2, snap.bookMetrics);
    tui.updateOhlcv(snap.candles, snap.candleMetrics);
    tui.updateLtp(snap.ltp);
  });

  // 5. Start everything
  ws.connect();
  await mtf.subscribe(pair);
  ws.subscribePair(pair);

  // 6. Graceful shutdown
  process.on('SIGINT', () => {
    ws.disconnect();
    mtf.destroy();
    tui.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
8. Package.json Additions
JSON
Copy
{
  "dependencies": {
    "socket.io-client": "2.4.0",
    "axios": "^1.6.0",
    "zod": "^3.22.0"
  }
}
Critical: CoinDCX specifically requires socket.io-client@2.4.0. Newer versions will not connect.
Summary: What You Get
Table
Feature Source Integration Point
Multi-timeframe OHLCV REST polling (/market_data/candles) MultiTimeframeStore → Strategy
Real-time L2 Order Book WebSocket (depth-update) CoinDcxWsClient → BookManager / Fusion
LTP / Ticker WebSocket (ticker) CoinDcxWsClient → Fusion → TUI
Trade Feed (CVD) WebSocket (trade) CoinDcxWsClient → Volume analysis
Fused Signal Combined book + candle analysis CoinDcxFusion → SmcRuleFused → Risk → TUI
Your existing ReadOnlyGuard, Postgres persistence, SignalBus, RiskFilter, and TUI all remain untouched. This is purely additive data plumbing that feeds your already-solid architecture.
