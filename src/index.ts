import { TuiApp } from './tui/app';
import { CoinDCXWs } from './gateways/coindcx-ws';
import { CoinDCXApi } from './gateways/coindcx-api';
import { config } from './config/config';

async function main() {
  const tui = new TuiApp();
  const ws = new CoinDCXWs();

  const state = {
    tickers: new Map<string, { price: string; change: string }>(),
    positions: [] as any[],
    balances: [] as any[],
    hasValidAuth: true
  };

  tui.log('Initializing...');

  function safeParse(data: any) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        return null;
      }
    }
    return data;
  }

  // Set initial placeholders
  tui.updateTickers([['Waiting for data...', '...', '...']]);
  tui.updatePositions([['Waiting for data...', '...', '...', '...', '...']]);
  tui.updateBalances([['Waiting...', '...', '...']]);

  // Initial data fetch
  try {
    if (config.apiKey && config.apiSecret) {
      tui.log('Fetching initial balances and positions...');
      const balances = await CoinDCXApi.getBalances();
      tui.log(`Fetched ${balances.length} balances`);
      state.balances = balances.map((b: any) => [b.currency, b.balance, b.locked_balance]);
      if (state.balances.length > 0) tui.updateBalances(state.balances);

      const positions = await CoinDCXApi.getFuturesPositions();
      tui.log(`Fetched positions: ${JSON.stringify(positions).substring(0, 100)}...`);
      
      const posArray = Array.isArray(positions) ? positions : (positions.data || []);
      state.positions = Array.isArray(posArray) ? posArray.map((p: any) => [
        p.pair || p.symbol || 'N/A',
        p.side || 'N/A',
        p.leverage || '1x',
        p.entry_price || p.entryPrice || '0',
        p.unrealized_pnl || p.unrealizedProfit || '0'
      ]) : [];
      if (state.positions.length > 0) tui.updatePositions(state.positions);
      tui.log(`Mapped ${state.positions.length} positions`);
    } else {
      tui.log('API Key/Secret missing - skipping private data fetch');
      state.hasValidAuth = false;
    }
  } catch (error: any) {
    tui.log(`AUTH ERROR: ${error.message}`);
    tui.log('Falling back to PUBLIC ONLY mode');
    state.hasValidAuth = false;
    ws.skipPrivate = true;
  }

  // WS Events
  ws.on('connected', () => {
    tui.log('WebSocket connected');
    if (!state.hasValidAuth) {
      tui.log('Auth invalid - skipping private channel join');
    }
  });

  ws.on('disconnected', (reason) => {
    tui.log(`WebSocket disconnected: ${reason}`);
  });

  ws.on('error', (error) => {
    tui.log(`WebSocket error: ${error.message}`);
  });

  ws.on('debug', (msg) => {
    tui.log(`WS DEBUG: ${msg}`);
  });

  ws.on('price-change', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const items = Array.isArray(data) ? data : [data];
    items.forEach(item => {
      if (item && item.s) {
        state.tickers.set(item.s, {
          price: item.p || '0',
          change: item.c || '0',
        });
      }
    });
    tui.updateTickers(Array.from(state.tickers.entries()).map(([pair, info]) => [
      pair,
      info.price,
      info.change
    ]));
  });

  ws.on('currentPrices@spot#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
      Object.entries(prices).forEach(([pair, price]: [string, any]) => {
        if (typeof price === 'number' || typeof price === 'string') {
          const existing = state.tickers.get(pair) || { price: '0', change: '0' };
          state.tickers.set(pair, { ...existing, price: price.toString() });
        }
      });
      const tickerData = Array.from(state.tickers.entries()).map(([pair, info]) => [
        pair,
        info.price,
        info.change
      ]);
      tui.updateTickers(tickerData);
    }
  });

  ws.on('currentPrices@futures#update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const prices = data.prices || data;
    if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
      Object.entries(prices).forEach(([pair, price]: [string, any]) => {
        if (typeof price === 'number' || typeof price === 'string') {
          const futuresPair = `${pair} (F)`;
          const existing = state.tickers.get(futuresPair) || { price: '0', change: '0' };
          state.tickers.set(futuresPair, { ...existing, price: price.toString() });
        }
      });
      const tickerData = Array.from(state.tickers.entries()).map(([pair, info]) => [
        pair,
        info.price,
        info.change
      ]);
      tui.updateTickers(tickerData);
    }
  });

  ws.on('balance-update', (data) => {
    tui.log(`Balance updated: ${JSON.stringify(data)}`);
    // Refresh balances via API or update local state
  });

  ws.on('order-update', (data) => {
    tui.log(`Order updated: ${data.status} for ${data.pair}`);
  });

  ws.on('trade-update', (data) => {
    tui.log(`Trade executed: ${data.pair} @ ${data.price}`);
  });

  ws.connect();

  // Periodic refresh for positions and balances
  setInterval(async () => {
    if (config.apiKey && config.apiSecret) {
      const positions = await CoinDCXApi.getFuturesPositions();
      state.positions = Array.isArray(positions) ? positions.map((p: any) => [
        p.pair,
        p.side,
        p.leverage,
        p.entry_price,
        p.unrealized_pnl
      ]) : [];
      tui.updatePositions(state.positions);
    }
  }, 30000);
}

main().catch((err) => {
  console.error('Main loop error:', err);
});
