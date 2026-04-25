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
    positions: new Map<string, any>(),
    orders: new Map<string, any>(),
    balanceMap: new Map<string, { balance: string; locked: string }>(),
    hasValidAuth: true,
    usdtInrRate: 88.5, // Fallback rate
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

  function refreshPositionsDisplay() {
    const rows = Array.from(state.positions.values())
      .filter((p: any) => p.active_pos !== 0) // Only show active positio
      .map((p: any) => [
        cleanPair(p.pair || 'N/A'),
        p.active_pos > 0 ? 'LONG' : 'SHORT',
        `${p.leverage || 1}x`,
        formatPrice(p.avg_price),
        formatPrice(p.mark_price),
        formatPnl(p.unrealized_pnl || 0),
      ]);
    tui.updatePositions(rows.length > 0 ? rows : [['No active positions', '—', '—', '—', '—', '—']]);
  }

  function refreshOrdersDisplay() {
    const rows = Array.from(state.orders.values())
      .map((o: any) => [
        cleanPair(o.pair || 'N/A'),
        (o.side || 'N/A').toUpperCase(),
        formatPrice(o.price),
        formatQty(o.total_quantity),
        (o.status || 'N/A').toUpperCase(),
      ]);
    tui.updateOrders(rows.length > 0 ? rows : [['No open orders', '—', '—', '—', '—']]);
  }

  function refreshBalanceDisplay() {
    const activePnlMap = new Map<string, number>();

    Array.from(state.positions.values()).forEach((p: any) => {
       const pnl = parseFloat(p.unrealized_pnl || '0');
       const currency = p.margin_currency_short_name || p.settlement_currency_short_name || 'USDT';
       activePnlMap.set(currency, (activePnlMap.get(currency) || 0) + pnl);
    });

    const rows: string[][] = [];

    Array.from(state.balanceMap.entries())
      .filter(([_, info]) => parseFloat(info.balance) > 0 || parseFloat(info.locked) > 0)
      .forEach(([currency, info]) => {
        const available = parseFloat(info.balance || '0');
        const locked = parseFloat(info.locked || '0');
        const walletBalance = available + locked;
        const activePnl = activePnlMap.get(currency) || 0;
        const currentValue = walletBalance + activePnl;

        rows.push([
          currency,
          formatQty(currentValue),
          formatQty(walletBalance),
          formatPnl(activePnl),
          formatQty(available),
          formatQty(locked)
        ]);

        if (currency === 'INR' && state.usdtInrRate > 0) {
          rows.push([
            '{cyan-fg}USD{/cyan-fg}',
            `{cyan-fg}$${formatQty(currentValue / state.usdtInrRate, 2)}{/cyan-fg}`,
            `{cyan-fg}$${formatQty(walletBalance / state.usdtInrRate, 2)}{/cyan-fg}`,
            formatPnl(activePnl / state.usdtInrRate),
            `{cyan-fg}$${formatQty(available / state.usdtInrRate, 2)}{/cyan-fg}`,
            `{cyan-fg}$${formatQty(locked / state.usdtInrRate, 2)}{/cyan-fg}`
          ]);
        }
      });
      
    tui.updateBalances(rows.length > 0 ? rows : [['No balances', '—', '—', '—', '—', '—']]);
  }

  // ── On Focus Change: re-filter trades + update header ──
  tui.setOnFocusChange(() => {
    refreshTradeDisplay();
    refreshHeader();
  });

  // ── Set initial placeholders ──
  tui.updateTrades([['Connecting...', '—', '—', '—', '—']]);
  tui.updatePositions([['Connecting...', '—', '—', '—', '—', '—']]);
  tui.updateBalances([['Connecting...', '—', '—', '—', '—', '—']]);
  tui.updateOrders([['No open orders', '—', '—', '—', '—']]);

  async function fetchPrivateData() {
    try {
      const tickers = await CoinDCXApi.getTickers();
      const usdtInrTicker = tickers.find((t: any) => t.market === 'USDTINR');
      if (usdtInrTicker && usdtInrTicker.last_price) {
        state.usdtInrRate = parseFloat(usdtInrTicker.last_price);
      }
    } catch (err) {
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
    fetchPrivateData();
    setInterval(fetchPrivateData, 30000); // refresh every 30s as a fallback
  } else {
    tui.log('⚠ API Key/Secret missing — PUBLIC ONLY mode');
    state.hasValidAuth = false;
    tui.updateBalances([['No API key', '—', '—', '—', '—', '—']]);
    tui.updatePositions([['No API key', '—', '—', '—', '—', '—']]);
  }
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

        if (pair === 'USDTINR') {
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
