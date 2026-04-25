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
}

interface TradeEntry {
  time: string;
  rawPair: string;   // e.g. "B-SOL_USDT"
  cleanPair: string;  // e.g. "SOLUSDT"
  price: string;
  qty: string;
  side: string;
}

// ══════════════════════════════════════════════════════
// ── Main ──
// ══════════════════════════════════════════════════════
async function main() {
  const tui = new TuiApp();
  const ws = new CoinDCXWs();

  const state = {
    tickers: new Map<string, TickerInfo>(),
    allTrades: [] as TradeEntry[],
    positions: [] as string[][],
    orders: [] as string[][],
    balanceMap: new Map<string, { balance: string; locked: string }>(),
    hasValidAuth: true,
  };

  const MAX_TRADES = 50;

  // ── Helpers ──
  function safeParse(data: any) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return null; }
    }
    return data;
  }

  function getFocusedCleanPair(): string {
    return tui.focusedPairClean;
  }

  function refreshTradeDisplay() {
    const focused = getFocusedCleanPair();
    const filtered = state.allTrades
      .filter(t => t.cleanPair === focused)
      .slice(0, 15)
      .map(t => [t.time, t.cleanPair, t.price, t.qty, t.side]);
    tui.updateTrades(filtered.length > 0
      ? filtered
      : [['—', `No trades for ${focused}`, '—', '—', '—']]);
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

  function refreshBalanceDisplay() {
    const rows = Array.from(state.balanceMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, info]) => [currency, info.balance, info.locked]);
    tui.updateBalances(rows.length > 0 ? rows : [['No balances', '—', '—']]);
  }

  // ── On Focus Change: re-filter trades + update header ──
  tui.setOnFocusChange(() => {
    refreshTradeDisplay();
    refreshHeader();
  });

  // ── Set initial placeholders ──
  tui.updateTrades([['Connecting...', '—', '—', '—', '—']]);
  tui.updatePositions([['Connecting...', '—', '—', '—', '—', '—']]);
  tui.updateBalances([['Connecting...', '—', '—']]);
  tui.updateOrders([['No open orders', '—', '—', '—', '—']]);

  // ══════════════════════════════════════════════════════
  // ── Initial REST API Fetch ──
  // ══════════════════════════════════════════════════════
  if (config.apiKey && config.apiSecret) {
    // Fetch balances
    try {
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
      tui.log(`✓ Loaded ${state.balanceMap.size} balances`);
      refreshBalanceDisplay();
    } catch (err: any) {
      tui.log(`⚠ Balance fetch failed: ${err.message}`);
      tui.updateBalances([['API error', err.message.substring(0, 30), '—']]);
    }

    // Fetch positions
    try {
      tui.log('Fetching futures positions...');
      const posRaw = await CoinDCXApi.getFuturesPositions();
      const posArr = Array.isArray(posRaw) ? posRaw : (posRaw?.data || []);
      state.positions = posArr
        .map((p: any) => [
          cleanPair(p.pair || 'N/A'),
          p.active_pos > 0 ? 'LONG' : (p.active_pos < 0 ? 'SHORT' : 'FLAT'),
          `${p.leverage || 1}x`,
          formatPrice(p.avg_price),
          formatPrice(p.mark_price),
          formatPnl(p.unrealized_pnl || 0),
        ]);
      tui.updatePositions(state.positions.length > 0
        ? state.positions
        : [['No active positions', '—', '—', '—', '—', '—']]);
      tui.log(`✓ Loaded ${state.positions.length} active positions`);
    } catch (err: any) {
      tui.log(`⚠ Position fetch failed: ${err.message}`);
      tui.updatePositions([['API error', '—', '—', '—', '—', '—']]);
    }
  } else {
    tui.log('⚠ API Key/Secret missing — PUBLIC ONLY mode');
    state.hasValidAuth = false;
    tui.updateBalances([['No API key', '—', '—']]);
    tui.updatePositions([['No API key', '—', '—', '—', '—', '—']]);
  }

  // ══════════════════════════════════════════════════════
  // ── WebSocket Events ──
  // ══════════════════════════════════════════════════════

  ws.on('connected', () => tui.log('✓ WebSocket connected'));
  ws.on('disconnected', (reason) => tui.log(`✗ Disconnected: ${reason}`));
  ws.on('error', (error) => tui.log(`✗ WS error: ${error.message}`));
  ws.on('debug', (msg) => tui.log(msg));

  // ── new-trade: { T, RT, p, q, m, s:"B-SOL_USDT", pr:"f" } ──
  ws.on('new-trade', (raw) => {
    const data = safeParse(raw);
    if (!data || !data.s) return;

    const pair = data.s;
    const clean = cleanPair(pair);
    const price = data.p;
    const isFutures = data.pr === 'f';

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
      refreshTradeDisplay();
    }
  });

  // ── currentPrices@spot#update: { prices: { "ATOMUSDT": "2.01", ... } } ──
  ws.on('currentPrices@spot#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return;

    Object.entries(prices).forEach(([pair, val]: [string, any]) => {
      const price = typeof val === 'object' ? (val.ls || val.mp || val.p) : val;
      if (price !== undefined && price !== null) {
        const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0' };
        const changeVal = typeof val === 'object' ? (val.pc || existing.change) : existing.change;
        state.tickers.set(pair, {
          ...existing,
          price: price.toString(),
          change: changeVal?.toString() || '0',
        });
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
    });
    refreshHeader();
  });

  // ── df-position-update: [{ pair, active_pos, avg_price, leverage, mark_price, ... }] ──
  ws.on('df-position-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const positions = Array.isArray(data) ? data : [data];
    tui.log(`Position update: ${positions.length} received`);

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
    tui.updatePositions(state.positions.length > 0
      ? state.positions
      : [['No active positions', '—', '—', '—', '—', '—']]);
  });

  // ── df-order-update: [{ pair, side, status, price, total_quantity, ... }] ──
  ws.on('df-order-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const orders = Array.isArray(data) ? data : [data];
    tui.log(`Order update: ${orders.length} received`);

    state.orders = orders
      .filter((o: any) => o.status === 'open' || o.status === 'partially_filled')
      .map((o: any) => [
        cleanPair(o.pair || 'N/A'),
        (o.side || 'N/A').toUpperCase(),
        formatPrice(o.price),
        formatQty(o.total_quantity),
        (o.status || 'N/A').toUpperCase(),
      ]);
    tui.updateOrders(state.orders.length > 0
      ? state.orders
      : [['No open orders', '—', '—', '—', '—']]);
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
      state.positions = posArr
        .map((p: any) => [
          cleanPair(p.pair || 'N/A'),
          p.active_pos > 0 ? 'LONG' : (p.active_pos < 0 ? 'SHORT' : 'FLAT'),
          `${p.leverage || 1}x`,
          formatPrice(p.avg_price),
          formatPrice(p.mark_price),
          formatPnl(p.unrealized_pnl || 0),
        ]);
      tui.updatePositions(state.positions.length > 0
        ? state.positions
        : [['No active positions', '—', '—', '—', '—', '—']]);

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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
