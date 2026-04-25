import { TuiApp } from './tui/app';
import { CoinDCXWs } from './gateways/coindcx-ws';
import { CoinDCXApi } from './gateways/coindcx-api';
import { config } from './config/config';
import { formatPrice, formatPnl, formatChange, cleanPair, formatQty, formatTime } from './utils/format';
import { bootstrap } from './lifecycle/bootstrap';
import { installSignalHandlers } from './lifecycle/shutdown';
import type { Context } from './lifecycle/context';
import { IntegrityController } from './marketdata/integrity-controller';
import ntp from 'ntp-client';
import axios from 'axios';

// ── Types ──
interface TickerInfo {
  price: string;
  markPrice: string;
  change: string;
}

interface TradeEntry {
  time: string;
  rawPair: string;   // e.g. "B-SOL_USDT"
  cleanPair: string;  // e.g. "SOLUSDT"
  price: string;
  qty: string;
  side: string;
}

// ── Global State ──
export const state = {
  isWsConnected: false,
  wsLatency: 0,
  lastPriceUpdate: 0,
  tickers: new Map<string, TickerInfo>(),
  allTrades: [] as TradeEntry[],
  positions: new Map<string, any>(),
  orders: new Map<string, any>(),
  balanceMap: new Map<string, { balance: string; locked: string }>(),
  orderBooks: new Map<string, { asks: Map<string, string>, bids: Map<string, string> }>(),
  hasValidAuth: true,
  usdtInrRate: 88.5, // Fallback rate
  selectedSymbol: 'SOLUSDT' // Initial focus
};

// ══════════════════════════════════════════════════════
// ── Main ──
// ══════════════════════════════════════════════════════
async function runApp(ctx: Context) {
  const tui = new TuiApp();
  const ws = new CoinDCXWs();
  ctx.logger.info({ mod: 'app' }, 'app start');

  const integrity = new IntegrityController({
    config: ctx.config,
    logger: ctx.logger.child({ mod: 'integrity' }),
    pool: ctx.pool,
    audit: ctx.audit,
    bus: ctx.bus,
    ws: ws as any,
    restFetchOrderBook: async (pair: string) => {
      const r = await axios.get('https://api.coindcx.com/exchange/v1/derivatives/data/orderbook', {
        params: { pair }, timeout: 10_000,
      });
      const data = r.data as { asks?: any; bids?: any };
      const toArr = (v: any): Array<[string, string]> => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') return Object.entries(v).map(([p, q]) => [p, String(q)] as [string, string]);
        return [];
      };
      return { asks: toArr(data.asks), bids: toArr(data.bids), ts: Date.now() };
    },
    fetchExchangeMs: async () => {
      const r = await axios.get('https://api.coindcx.com/exchange/v1/markets', { timeout: 5000 });
      const dh = r.headers['date'];
      if (typeof dh === 'string') return Date.parse(dh);
      throw new Error('no date header');
    },
    fetchNtpMs: () => new Promise((resolve, reject) => {
      ntp.getNetworkTime('pool.ntp.org', 123, (err, date) => {
        if (err || !date) return reject(err ?? new Error('ntp failed'));
        resolve(date.getTime());
      });
    }),
  });
  integrity.start();

  ws.on('depth-snapshot', (raw: any) => integrity.ingest('depth-snapshot', raw));
  ws.on('depth-update',   (raw: any) => integrity.ingest('depth-update',   raw));
  ws.on('new-trade',      (raw: any) => integrity.ingest('new-trade',      raw));
  ws.on('currentPrices@futures#update', (raw: any) => integrity.ingest('currentPrices@futures#update', raw));
  ws.on('currentPrices@spot#update',    (raw: any) => integrity.ingest('currentPrices@spot#update',    raw));

  const MAX_TRADES = 50;

  function safeParse(data: any) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return null; }
    }
    return data;
  }

  function getFocusedCleanPair(): string {
    return tui.focusedPairClean;
  }

  function getMarketPulse(): any {
    const symbol = getFocusedCleanPair();
    const info = state.tickers.get(symbol);
    const book = state.orderBooks.get(symbol);
    const asks = Array.from(book?.asks.entries() || []).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    const bids = Array.from(book?.bids.entries() || []).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    
    return {
      symbol,
      price: info?.price || '0',
      change24h: info?.change || '0',
      orderBook: {
        bestAsk: asks[0]?.[0] || '0',
        bestBid: bids[0]?.[0] || '0',
        spread: asks[0] && bids[0] ? (parseFloat(asks[0][0]) - parseFloat(bids[0][0])).toString() : '0'
      },
      positions: Array.from(state.positions.values()).filter(p => cleanPair(p.pair) === symbol)
    };
  }

  // ── AI Analysis Loop ──
  setInterval(async () => {
    try {
      const symbol = getFocusedCleanPair();
      // Fetch 15m candles to build structural context
      const rawCandles = await CoinDCXApi.getCandles(symbol, '15m', 50);
      
      // Map to standard Candle interface
      const candles = (Array.isArray(rawCandles) ? rawCandles : []).map((c: any) => ({
        timestamp: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
      }));

      const pulse = getMarketPulse();
      // Build institutional market state
      const marketState = ctx.stateBuilder.build(candles, pulse.orderBook, pulse.positions);
      
      if (marketState) {
        marketState.symbol = symbol;
        const analysis = await ctx.analyzer.analyze(marketState);
        tui.updateAi(analysis);
      } else {
        tui.updateAi({ 
          verdict: 'Collecting structural data...', 
          signal: 'WAIT', 
          confidence: 0,
          no_trade_condition: 'Insufficient candles'
        });
      }
    } catch (err: any) {
      ctx.logger.error({ mod: 'ai', err: err.message }, 'AI loop failed');
    }
  }, 60000);

  function refreshBookDisplay() {
    const focused = getFocusedCleanPair();
    const book = state.orderBooks.get(focused);
    const ticker = state.tickers.get(focused);
    
    if (!book) {
       tui.updateOrderBook([], [], ticker?.price || '—');
       return;
    }

    const formatBookRow = (price: string, qty: string, cumulative: number) => [
      formatPrice(price),
      formatQty(parseFloat(price) * parseFloat(qty)), // Amount in INR
      formatQty(cumulative) // Cumulative in INR
    ];

    let askCumulative = 0;
    const asks = Array.from(book.asks.entries())
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .slice(0, 10)
      .map(([p, q]) => {
         askCumulative += parseFloat(p) * parseFloat(q);
         return formatBookRow(p, q, askCumulative);
      });

    let bidCumulative = 0;
    const bids = Array.from(book.bids.entries())
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .slice(0, 10)
      .map(([p, q]) => {
         bidCumulative += parseFloat(p) * parseFloat(q);
         return formatBookRow(p, q, bidCumulative);
      });

    tui.updateOrderBook(asks, bids, ticker?.price || '—');
    tui.updateStatus({ lastUpdate: Date.now() });
  }

  function refreshHeader() {
    const focused = getFocusedCleanPair();
    const info = state.tickers.get(focused);
    if (info) {
      tui.updateHeader({
        ltp: formatPrice(info.price),
        mark: formatPrice(info.markPrice),
        change: info.change !== '0' && info.change !== '' ? formatChange(info.change) : undefined,
      });
    } else {
      tui.updateHeader();
    }
  }

  function refreshPositionsDisplay() {
    const rows = Array.from(state.positions.values())
      .filter((p: any) => p.active_pos !== 0) // Only show active positions
      .map((p: any) => {
        const clean = cleanPair(p.pair || 'N/A');
        const sym = clean.replace('USDT', '');
        const ticker = state.tickers.get(clean);
        return [
          sym,
          p.active_pos > 0 ? '{green-fg}LONG{/green-fg}' : '{red-fg}SHORT{/red-fg}',
          formatQty(Math.abs(p.active_pos)),
          formatPrice(p.avg_price),
          ticker ? formatPrice(ticker.price) : '—',
          formatPrice(p.mark_price),
          '—',
          formatPnl(p.unrealized_pnl || 0),
        ];
      });
    tui.updatePositions(rows.length > 0 ? rows : [['—', '—', '—', '—', '—', '—', '—', '—']]);
  }

  function refreshOrdersDisplay() {
    const rows = Array.from(state.orders.values())
      .map((o: any) => {
        const side = (o.side || 'N/A').toUpperCase();
        const sideChar = side === 'BUY' ? '{green-fg}B{/green-fg}' : '{red-fg}S{/red-fg}';
        return [
          sideChar,
          cleanPair(o.pair || 'N/A'),
          (o.status || 'N/A').substring(0, 4).toUpperCase(),
          '—'
        ];
      });
    tui.updateOrders(rows.length > 0 ? rows : [['—', '—', '—', '—']]);
  }

  function refreshBalanceDisplay() {
    const activePnlMap = new Map<string, number>();
    let totalEqInr = 0;
    let totalWalInr = 0;
    let totalPnlInr = 0;

    Array.from(state.positions.values()).forEach((p: any) => {
       const pnl = parseFloat(p.unrealized_pnl || '0');
       const currency = (p.margin_currency_short_name || p.settlement_currency_short_name || 'USDT').toUpperCase();
       activePnlMap.set(currency, (activePnlMap.get(currency) || 0) + pnl);
       
       // Add to total global PnL (converted to INR)
       if (currency === 'INR') {
         totalPnlInr += pnl;
       } else if (currency === 'USDT' || currency === 'USD') {
         totalPnlInr += pnl * state.usdtInrRate;
       }
    });

    const rows: string[][] = [];

    Array.from(state.balanceMap.entries())
      .filter(([_, info]) => parseFloat(info.balance) > 0 || parseFloat(info.locked) > 0)
      .forEach(([currency, info]) => {
        const available = parseFloat(info.balance || '0');
        const locked = parseFloat(info.locked || '0');
        const walletBalance = available + locked;
        let activePnl = activePnlMap.get(currency) || 0;
        
        // For the main INR row, show the total aggregated PnL across all currencies
        if (currency === 'INR') {
          activePnl = totalPnlInr;
        }
        
        const currentValue = walletBalance + activePnl;
        const pnlPct = walletBalance > 0 ? (activePnl / walletBalance) * 100 : 0;
        const utilPct = walletBalance > 0 ? (locked / walletBalance) * 100 : 0;

        // Add to global totals (converted to INR)
        const inrValue = currency === 'INR' ? currentValue : currentValue * state.usdtInrRate;
        const inrWallet = currency === 'INR' ? walletBalance : walletBalance * state.usdtInrRate;
        totalEqInr += inrValue;
        totalWalInr += inrWallet;

        const isInr = currency === 'INR' || currency === 'USDTINR'; // Special case for INR-settled
        const prefix = isInr ? '₹' : '';

        rows.push([
          isInr ? '₹ INR' : currency,
          `${prefix}${formatQty(currentValue)}`,
          `${prefix}${formatQty(walletBalance)}`,
          formatPnl(activePnl, prefix),
          `{${pnlPct >= 0 ? 'green' : 'red'}-fg}${pnlPct.toFixed(2)}%{/${pnlPct >= 0 ? 'green' : 'red'}-fg}`,
          `${prefix}${formatQty(available)}`,
          `${prefix}${formatQty(locked)}`,
          `{yellow-fg}${utilPct.toFixed(1)}%{/yellow-fg}`
        ]);

        if (isInr && state.usdtInrRate > 0) {
          const usdEq = currentValue / state.usdtInrRate;
          const usdWal = walletBalance / state.usdtInrRate;
          rows.push([
            '{cyan-fg}$ USD{/cyan-fg}',
            `{cyan-fg}$${formatQty(usdEq, 2)}{/cyan-fg}`,
            `{cyan-fg}$${formatQty(usdWal, 2)}{/cyan-fg}`,
            formatPnl(activePnl / state.usdtInrRate, '$'),
            `{${pnlPct >= 0 ? 'green' : 'red'}-fg}${pnlPct.toFixed(2)}%{/${pnlPct >= 0 ? 'green' : 'red'}-fg}`,
            `{cyan-fg}$${formatQty(available / state.usdtInrRate, 2)}{/cyan-fg}`,
            `{cyan-fg}$${formatQty(locked / state.usdtInrRate, 2)}{/cyan-fg}`,
            `{yellow-fg}${utilPct.toFixed(1)}%{/yellow-fg}`
          ]);
        }
      });
      
    tui.updateBalances(rows.length > 0 ? rows : [['No balances', '—', '—', '—', '—', '—']]);
    
    // Update top summary bar
    tui.updateSummary({
      equity: `₹${formatQty(totalEqInr)} (${formatQty(totalEqInr / state.usdtInrRate, 2)} USDT)`,
      wallet: `₹${formatQty(totalWalInr)} (${formatQty(totalWalInr / state.usdtInrRate, 2)} USDT)`,
      net: formatPnl(totalPnlInr, '₹'),
      unrealUsdt: `${formatQty(totalPnlInr / state.usdtInrRate, 2)} USDT`
    });
  }

  // ── On Focus Change: re-filter trades + update header ──
  tui.setOnFocusChange(() => {
    refreshBookDisplay();
    refreshHeader();
  });

  // ── Set initial placeholders ──
  tui.updateOrderBook([], [], 'Connecting...');
  tui.updatePositions([['—', 'Connecting...', '—', '—', '—', '—', '—', '—']]);
  tui.updateBalances([['—', 'Connecting...', '—', '—', '—', '—']]);
  tui.updateOrders([['—', 'Connecting...', '—', '—']]);

  async function fetchPrivateData() {
    try {
      const tickers = await CoinDCXApi.getTickers();
      const usdtInrTicker = tickers.find((t: any) => t.market === 'USDTINR');
      if (usdtInrTicker && usdtInrTicker.last_price) {
        state.usdtInrRate = parseFloat(usdtInrTicker.last_price);
      }
    } catch (_err) {
      // Ignore ticker fetch errors
    }

    if (!state.hasValidAuth) return;

    try {
      tui.log('Fetching account balances...');
      const balances = await CoinDCXApi.getBalances();
      const balArr = Array.isArray(balances) ? balances : [];
      balArr.forEach((b: any) => {
        const currency = b.currency || b.currency_short_name;
        if (!currency) return;
        const newBal = b.balance?.toString() || '0';
        const newLocked = (b.locked_balance ?? b.locked ?? '0').toString();

        state.balanceMap.set(currency, {
          balance: newBal,
          locked: newLocked,
        });
      });
      tui.log(`✓ Loaded ${state.balanceMap.size} balances`);
      refreshBalanceDisplay();
    } catch (err: any) {
      tui.log(`⚠ Balance fetch failed: ${err.message}`);
      tui.updateBalances([['API error', err.message.substring(0, 30), '—', '—', '—', '—']]);
    }

    try {
      tui.log('Fetching futures positions...');
      const posRaw = await CoinDCXApi.getFuturesPositions();
      const posArr = Array.isArray(posRaw) ? posRaw : (posRaw?.data || []);

      // Update Map
      state.positions.clear();
      posArr.forEach((p: any) => {
        if (p.id) state.positions.set(p.id, p);
      });

      refreshPositionsDisplay();
      refreshBalanceDisplay(); // Because PnL depends on positions
      tui.log(`✓ Loaded ${state.positions.size} active positions`);
    } catch (err: any) {
      tui.log(`⚠ Position fetch failed: ${err.message}`);
      tui.updatePositions([['API error', '—', '—', '—', '—', '—']]);
    }
  }

  // ══════════════════════════════════════════════════════
  // ── Initial REST API Fetch ──
  // ══════════════════════════════════════════════════════
  if (config.apiKey && config.apiSecret) {
    void fetchPrivateData();
    setInterval(fetchPrivateData, 30000); // refresh every 30s as a fallback
  } else {
    tui.log('⚠ API Key/Secret missing — PUBLIC ONLY mode');
    state.hasValidAuth = false;
    tui.updateBalances([['No API key', '—', '—', '—', '—', '—']]);
    tui.updatePositions([['No API key', '—', '—', '—', '—', '—']]);
  }
  // ── WebSocket Events ──
  // ══════════════════════════════════════════════════════

  ws.on('connected', () => {
    state.isWsConnected = true;
    tui.log('✓ WebSocket connected');
    tui.updateStatus({ connected: true });
    ctx.audit.recordEvent({ kind: 'ws_reconnect', source: 'ws', payload: {} });
  });
  ws.on('disconnected', (reason) => {
    state.isWsConnected = false;
    tui.log(`✗ Disconnected: ${reason}`);
    tui.updateStatus({ connected: false });
  });
  ws.on('error', (error) => {
    tui.log(`✗ WS error: ${error.message}`);
    tui.updateStatus({ connected: false });
  });
  ws.on('debug', (msg) => ctx.logger.debug({ mod: 'ws' }, msg));

  // ── new-trade: { T, RT, p, q, m, s:"B-SOL_USDT", pr:"f" } ──
  ws.on('new-trade', (raw) => {
    const data = safeParse(raw);
    if (!data || !data.s) return;

    const pair = data.s;
    const clean = cleanPair(pair);
    const price = data.p;
    const _isFutures = data.pr === 'f';

    // Update ticker
    if (clean && price) {
      const existing = state.tickers.get(clean) || { price: '0', markPrice: '0', change: '0' };
      state.tickers.set(clean, { ...existing, price });

      // If this is the focused pair, update header
      if (clean === getFocusedCleanPair()) {
        refreshHeader();
      }
    }

    // Store trade
    state.allTrades.unshift({
      time: formatTime(data.T),
      rawPair: pair,
      cleanPair: clean,
      price: formatPrice(price),
      qty: formatQty(data.q),
      side: data.m ? 'MAKER' : 'TAKER',
    });
    if (state.allTrades.length > MAX_TRADES) {
      state.allTrades = state.allTrades.slice(0, MAX_TRADES);
    }

    // Refresh trade table only if this trade matches focused pair
    if (clean === getFocusedCleanPair()) {
      refreshBookDisplay();
    }
  });
  // ── depth-snapshot ──
  ws.on('depth-snapshot', (raw) => {
    const data = safeParse(raw);
    if (!data || !data.s) return;
    const pair = cleanPair(data.s);
    
    const asks = new Map<string, string>();
    const bids = new Map<string, string>();
    
    const rawAsks = Array.isArray(data.asks) ? data.asks : (data.asks ? Object.entries(data.asks) : []);
    const rawBids = Array.isArray(data.bids) ? data.bids : (data.bids ? Object.entries(data.bids) : []);

    rawAsks.forEach(([p, q]: [any, any]) => asks.set(p.toString(), q.toString()));
    rawBids.forEach(([p, q]: [any, any]) => bids.set(p.toString(), q.toString()));
    
    state.orderBooks.set(pair, { asks, bids });
    if (pair === getFocusedCleanPair()) refreshBookDisplay();
  });

  // ── depth-update ──
  ws.on('depth-update', (raw) => {
    const data = safeParse(raw);
    if (!data || !data.s) return;
    const pair = cleanPair(data.s);
    let book = state.orderBooks.get(pair);
    
    if (!book) {
       book = { asks: new Map(), bids: new Map() };
       state.orderBooks.set(pair, book);
    }
    
    const rawAsks = Array.isArray(data.asks) ? data.asks : (data.asks ? Object.entries(data.asks) : []);
    const rawBids = Array.isArray(data.bids) ? data.bids : (data.bids ? Object.entries(data.bids) : []);

    rawAsks.forEach(([p, q]: [any, any]) => {
      if (parseFloat(q) === 0) book!.asks.delete(p.toString());
      else book!.asks.set(p.toString(), q.toString());
    });
    
    rawBids.forEach(([p, q]: [any, any]) => {
      if (parseFloat(q) === 0) book!.bids.delete(p.toString());
      else book!.bids.set(p.toString(), q.toString());
    });
    
    if (pair === getFocusedCleanPair()) refreshBookDisplay();
  });

  // ── currentPrices@spot#update: { prices: { "ATOMUSDT": "2.01", ... } } ──
  ws.on('currentPrices@spot#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return;

    Object.entries(prices).forEach(([pair, val]: [string, any]) => {
      const price = (val && typeof val === 'object') ? (val.ls || val.mp || val.p) : val;
      if (price !== undefined && price !== null) {
        const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0' };
        const changeVal = (val && typeof val === 'object') ? (val.pc || existing.change) : existing.change;
        state.tickers.set(pair, {
          ...existing,
          price: price.toString(),
          change: changeVal?.toString() || '0',
        });

        const clean = cleanPair(pair);
        if (clean === 'USDTINR') {
          state.usdtInrRate = parseFloat(price.toString());
        }
      }
    });
    refreshHeader();
  });

  // ── currentPrices@futures#update: { prices: { "B-SOL_USDT": { mp, ls, pc, ... } } } ──
  ws.on('currentPrices@futures#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return;

    let positionsUpdated = false;

    Object.entries(prices).forEach(([rawPair, info]: [string, any]) => {
      if (!info || typeof info !== 'object') return;
      const pair = cleanPair(rawPair);
      const lastPrice = info.ls || info.mp;
      const markPrice = info.mp;
      const changePct = info.pc;

      const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0' };
      state.tickers.set(pair, {
        price: lastPrice?.toString() || existing.price,
        markPrice: markPrice?.toString() || existing.markPrice,
        change: changePct?.toString() || existing.change,
      });

      if (pair === 'USDTINR') {
        state.usdtInrRate = parseFloat(lastPrice?.toString() || state.usdtInrRate.toString());
      }

      // Update active positions PnL in real-time
      if (markPrice) {
        state.positions.forEach((pos: any) => {
          if (cleanPair(pos.pair) === pair && pos.active_pos !== 0) {
            const mp = parseFloat(markPrice);
            const avg = parseFloat(pos.avg_price || '0');
            const qty = parseFloat(pos.active_pos || '0');
            pos.mark_price = mp;
            pos.unrealized_pnl = (mp - avg) * qty;
            positionsUpdated = true;
          }
        });
      }
    });

    if (positionsUpdated) {
      refreshPositionsDisplay();
      refreshBalanceDisplay();
    }
    refreshHeader();
  });

  // ── df-position-update: [{ pair, active_pos, avg_price, leverage, mark_price, ... }] ──
  ws.on('df-position-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const positions = Array.isArray(data) ? data : [data];
    tui.log(`Position update: ${positions.length} received`);

    positions.forEach((p: any) => {
      if (p.id) {
        state.positions.set(p.id, p);
      }
    });

    refreshPositionsDisplay();
    refreshBalanceDisplay(); // Update PnL in balance
  });

  // ── df-order-update: [{ pair, side, status, price, total_quantity, ... }] ──
  ws.on('df-order-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const orders = Array.isArray(data) ? data : [data];
    tui.log(`Order update: ${orders.length} received`);

    orders.forEach((o: any) => {
      if (o.id) {
        if (o.status === 'open' || o.status === 'partially_filled') {
          state.orders.set(o.id, o);
        } else {
          state.orders.delete(o.id);
        }
      }
    });

    refreshOrdersDisplay();
  });

  // ── balance-update: [{ balance, locked_balance, currency_short_name }] ──
  ws.on('balance-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const balances = Array.isArray(data) ? data : [data];
    tui.log(`Balance update: ${balances.length} assets`);

    balances.forEach((b: any) => {
      const name = b.currency_short_name || b.currency || 'N/A';
      state.balanceMap.set(name, {
        balance: b.balance?.toString() || '0',
        locked: (b.locked_balance ?? '0').toString(),
      });
    });
    refreshBalanceDisplay();
  });

  // ── Connect ──
  ws.connect();

  // ══════════════════════════════════════════════════════
  // ── Periodic Refresh (30s) ──
  // ══════════════════════════════════════════════════════
  setInterval(async () => {
    if (!config.apiKey || !config.apiSecret || !state.hasValidAuth) return;
    try {
      const posRaw = await CoinDCXApi.getFuturesPositions();
      const posArr = Array.isArray(posRaw) ? posRaw : (posRaw?.data || []);

      state.positions.clear();
      posArr.forEach((p: any) => {
        if (p.id) state.positions.set(p.id, p);
      });
      refreshPositionsDisplay();
      const tickers = await CoinDCXApi.getTickers();
      const usdtInrTicker = tickers.find((t: any) => t.market === 'USDTINR');
      if (usdtInrTicker && usdtInrTicker.last_price) {
        state.usdtInrRate = parseFloat(usdtInrTicker.last_price);
      }

      const balances = await CoinDCXApi.getBalances();
      (Array.isArray(balances) ? balances : []).forEach((b: any) => {
        const name = b.currency_short_name || b.currency || 'N/A';
        state.balanceMap.set(name, {
          balance: b.balance?.toString() || '0',
          locked: (b.locked_balance ?? b.locked ?? '0').toString(),
        });
      });
      refreshBalanceDisplay();
    } catch (err: any) {
      tui.log(`Refresh error: ${err.message}`);
    }
  }, 30_000);
}

async function main() {
  const ctx = await bootstrap();
  installSignalHandlers(ctx);
  await runApp(ctx);
}

main().catch((err) => {
  // Use a fallback logger if ctx is not yet initialized
  const msg = err instanceof Error ? err.stack : String(err);
  process.stderr.write(`\n\nFATAL ERROR: ${msg}\n`);
  process.exit(1);
});
