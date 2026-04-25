import { TuiApp } from './tui/app';
import { CoinDCXWs } from './gateways/coindcx-ws';
import { CoinDCXApi } from './gateways/coindcx-api';
import { config } from './config/config';
import { formatPrice, formatPnl, formatChange, cleanPair, formatQty, formatTime } from './utils/format';

// ── Types ──
interface TickerInfo {
  price: string;
  markPrice: string;
  change: string;
  product: 'F' | 'S' | '';
}

interface TradeEntry {
  time: string;
  pair: string;
  price: string;
  qty: string;
  side: string;
}

// ── Main ──
async function main() {
  const tui = new TuiApp();
  const ws = new CoinDCXWs();

  const state = {
    tickers: new Map<string, TickerInfo>(),
    positions: [] as string[][],
    balanceMap: new Map<string, { balance: string; locked: string }>(),
    orders: [] as string[][],
    recentTrades: [] as TradeEntry[],
    hasValidAuth: true,
  };

  const MAX_RECENT_TRADES = 20;

  // ── Helpers ──
  function safeParse(data: any) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return null; }
    }
    return data;
  }

  function refreshTickerDisplay() {
    const rows = Array.from(state.tickers.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([pair, info]) => [
        pair,
        formatPrice(info.price),
        info.change !== '0' && info.change !== '' ? formatChange(info.change) : '—',
      ]);
    if (rows.length > 0) tui.updateTickers(rows);
  }

  function refreshBalanceDisplay() {
    const rows = Array.from(state.balanceMap.entries())
      .filter(([, info]) => parseFloat(info.balance) > 0 || parseFloat(info.locked) > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, info]) => [currency, info.balance, info.locked]);
    if (rows.length > 0) tui.updateBalances(rows);
  }

  function refreshTradeDisplay() {
    const rows = state.recentTrades.slice(0, 15).map(t => [
      t.time, t.pair, t.price, t.qty, t.side,
    ]);
    if (rows.length > 0) tui.updateTrades(rows);
  }

  // ── Set initial placeholders ──
  tui.updateTickers([['Connecting...', '—', '—']]);
  tui.updatePositions([['Connecting...', '—', '—', '—', '—', '—']]);
  tui.updateBalances([['Connecting...', '—', '—']]);
  tui.updateTrades([['Connecting...', '—', '—', '—', '—']]);
  tui.updateOrders([['No open orders', '—', '—', '—', '—']]);

  // ══════════════════════════════════════════════════════
  // ── Initial REST API Fetch ──
  // ══════════════════════════════════════════════════════
  try {
    if (config.apiKey && config.apiSecret) {
      tui.log('Fetching balances...');
      const balances = await CoinDCXApi.getBalances();
      const balArr = Array.isArray(balances) ? balances : [];
      balArr.forEach((b: any) => {
        const name = b.currency_short_name || b.currency || 'N/A';
        state.balanceMap.set(name, {
          balance: b.balance?.toString() || '0',
          locked: (b.locked_balance ?? b.locked ?? '0').toString(),
        });
      });
      tui.log(`Loaded ${state.balanceMap.size} balances`);
      refreshBalanceDisplay();

      tui.log('Fetching futures positions...');
      const posRaw = await CoinDCXApi.getFuturesPositions();
      const posArr = Array.isArray(posRaw) ? posRaw : (posRaw?.data || []);
      state.positions = posArr
        .filter((p: any) => p.active_pos !== undefined && p.active_pos !== 0)
        .map((p: any) => [
          cleanPair(p.pair || 'N/A'),
          p.active_pos > 0 ? 'LONG' : 'SHORT',
          `${p.leverage || 1}x`,
          formatPrice(p.avg_price),
          formatPrice(p.mark_price),
          formatPnl(p.unrealized_pnl || 0),
        ]);
      if (state.positions.length > 0) {
        tui.updatePositions(state.positions);
      } else {
        tui.updatePositions([['No positions', '—', '—', '—', '—', '—']]);
      }
      tui.log(`Loaded ${state.positions.length} active positions`);
    } else {
      tui.log('⚠ API Key/Secret missing — running PUBLIC ONLY mode');
      state.hasValidAuth = false;
      tui.updateBalances([['No API key', '—', '—']]);
      tui.updatePositions([['No API key', '—', '—', '—', '—', '—']]);
    }
  } catch (error: any) {
    tui.log(`AUTH ERROR: ${error.message}`);
    tui.log('Falling back to PUBLIC ONLY mode');
    state.hasValidAuth = false;
    ws.skipPrivate = true;
    tui.updateBalances([['Auth error', '—', '—']]);
    tui.updatePositions([['Auth error', '—', '—', '—', '—', '—']]);
  }

  // ══════════════════════════════════════════════════════
  // ── WebSocket Events ──
  // ══════════════════════════════════════════════════════

  ws.on('connected', () => tui.log('✓ WebSocket connected'));
  ws.on('disconnected', (reason) => tui.log(`✗ WebSocket disconnected: ${reason}`));
  ws.on('error', (error) => tui.log(`✗ WebSocket error: ${error.message}`));
  ws.on('debug', (msg) => tui.log(msg));

  // ── new-trade: Has symbol (s), price (p), quantity (q), maker (m) ──
  // Payload: { T, RT, p, q, m, s: "B-ID_USDT", pr: "f" }
  ws.on('new-trade', (raw) => {
    const data = safeParse(raw);
    if (!data || !data.s) return;

    const pair = cleanPair(data.s);
    const price = data.p;
    const qty = data.q;
    const isFutures = data.pr === 'f';
    const side = data.m ? 'MAKER' : 'TAKER';

    // Update ticker price from trade
    if (pair && price) {
      const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0', product: '' };
      state.tickers.set(pair, {
        ...existing,
        price,
        product: isFutures ? 'F' : 'S',
      });
      refreshTickerDisplay();
    }

    // Track recent trades
    state.recentTrades.unshift({
      time: formatTime(data.T),
      pair,
      price: formatPrice(price),
      qty: formatQty(qty),
      side,
    });
    if (state.recentTrades.length > MAX_RECENT_TRADES) {
      state.recentTrades = state.recentTrades.slice(0, MAX_RECENT_TRADES);
    }
    refreshTradeDisplay();
  });

  // ── currentPrices@spot#update: Spot price broadcast ──
  // Payload: { vs, ts, prices: { "ATOMUSDT": "2.0191", ... } }
  ws.on('currentPrices@spot#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return;

    Object.entries(prices).forEach(([pair, val]: [string, any]) => {
      const price = typeof val === 'object' ? (val.ls || val.mp || val.p) : val;
      if (price !== undefined && price !== null) {
        const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0', product: '' };
        const changeVal = typeof val === 'object' ? (val.pc || existing.change) : existing.change;
        state.tickers.set(pair, {
          ...existing,
          price: price.toString(),
          change: changeVal?.toString() || '0',
          product: 'S',
        });
      }
    });
    refreshTickerDisplay();
  });

  // ── currentPrices@futures#update: Futures price broadcast ──
  // Payload: { vs, ts, pr:"futures", prices: { "B-UNI_USDT": { mp, ls, pc, bmST, cmRT }, ... } }
  ws.on('currentPrices@futures#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return;

    Object.entries(prices).forEach(([rawPair, info]: [string, any]) => {
      if (!info || typeof info !== 'object') return;
      const pair = cleanPair(rawPair);
      const lastPrice = info.ls || info.mp;  // ls = last price, mp = mark price
      const markPrice = info.mp;
      const changePct = info.pc;

      const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0', product: '' };
      state.tickers.set(pair, {
        price: lastPrice?.toString() || existing.price,
        markPrice: markPrice?.toString() || existing.markPrice,
        change: changePct?.toString() || existing.change,
        product: 'F',
      });
    });
    refreshTickerDisplay();
  });

  // ── price-change: LTP update (no symbol field — context from channel) ──
  // Payload: { T, p, pr:"f" } — we skip this as new-trade provides richer data
  // Intentionally not handled for ticker mapping since it lacks symbol

  // ── df-position-update: Live position changes ──
  // Payload: [{ id, pair, active_pos, avg_price, leverage, mark_price, liquidation_price, ... }]
  ws.on('df-position-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const positions = Array.isArray(data) ? data : [data];
    tui.log(`Position update: ${positions.length} positions received`);

    state.positions = positions
      .filter((p: any) => p.active_pos !== undefined && p.active_pos !== 0)
      .map((p: any) => [
        cleanPair(p.pair || 'N/A'),
        p.active_pos > 0 ? 'LONG' : 'SHORT',
        `${p.leverage || 1}x`,
        formatPrice(p.avg_price),
        formatPrice(p.mark_price),
        formatPnl(p.unrealized_pnl || 0),
      ]);

    if (state.positions.length > 0) {
      tui.updatePositions(state.positions);
    } else {
      tui.updatePositions([['No positions', '—', '—', '—', '—', '—']]);
    }
  });

  // ── df-order-update: Live order changes ──
  // Payload: [{ id, pair, side, status, order_type, price, total_quantity, ... }]
  ws.on('df-order-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const orders = Array.isArray(data) ? data : [data];
    tui.log(`Order update: ${orders.length} orders`);

    state.orders = orders
      .filter((o: any) => o.status === 'open' || o.status === 'partially_filled')
      .map((o: any) => [
        cleanPair(o.pair || 'N/A'),
        (o.side || 'N/A').toUpperCase(),
        formatPrice(o.price),
        formatQty(o.total_quantity),
        (o.status || 'N/A').toUpperCase(),
      ]);

    if (state.orders.length > 0) {
      tui.updateOrders(state.orders);
    } else {
      tui.updateOrders([['No open orders', '—', '—', '—', '—']]);
    }
  });

  // ── balance-update: Live balance changes ──
  // Payload: [{ id, balance, locked_balance, currency_short_name }]
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

  // ── Connect WebSocket ──
  ws.connect();

  // ══════════════════════════════════════════════════════
  // ── Periodic Refresh (positions + balances every 30s) ──
  // ══════════════════════════════════════════════════════
  setInterval(async () => {
    if (!config.apiKey || !config.apiSecret || !state.hasValidAuth) return;

    try {
      // Refresh positions
      const posRaw = await CoinDCXApi.getFuturesPositions();
      const posArr = Array.isArray(posRaw) ? posRaw : (posRaw?.data || []);
      state.positions = posArr
        .filter((p: any) => p.active_pos !== undefined && p.active_pos !== 0)
        .map((p: any) => [
          cleanPair(p.pair || 'N/A'),
          p.active_pos > 0 ? 'LONG' : 'SHORT',
          `${p.leverage || 1}x`,
          formatPrice(p.avg_price),
          formatPrice(p.mark_price),
          formatPnl(p.unrealized_pnl || 0),
        ]);
      if (state.positions.length > 0) {
        tui.updatePositions(state.positions);
      } else {
        tui.updatePositions([['No positions', '—', '—', '—', '—', '—']]);
      }

      // Refresh balances
      const balances = await CoinDCXApi.getBalances();
      const balArr = Array.isArray(balances) ? balances : [];
      balArr.forEach((b: any) => {
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
