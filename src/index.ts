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
  };

  tui.log('Initializing...');

  // Initial data fetch
  try {
    if (config.apiKey && config.apiSecret) {
      tui.log('Fetching initial balances and positions...');
      const balances = await CoinDCXApi.getBalances();
      state.balances = balances.map((b: any) => [b.currency, b.balance, b.locked_balance]);
      tui.updateBalances(state.balances);

      const positions = await CoinDCXApi.getFuturesPositions();
      // Handle different response formats if necessary
      state.positions = Array.isArray(positions) ? positions.map((p: any) => [
        p.pair,
        p.side,
        p.leverage,
        p.entry_price,
        p.unrealized_pnl
      ]) : [];
      tui.updatePositions(state.positions);
    }
  } catch (error) {
    tui.log(`Initial fetch error: ${error}`);
  }

  // WS Events
  ws.on('connected', () => {
    tui.log('WebSocket connected');
  });

  ws.on('disconnected', (reason) => {
    tui.log(`WebSocket disconnected: ${reason}`);
  });

  ws.on('error', (error) => {
    tui.log(`WebSocket error: ${error.message}`);
  });

  ws.on('price-change', (data) => {
    // data format depends on the channel, usually { p: price, c: change, s: symbol }
    if (data && data.s) {
      state.tickers.set(data.s, {
        price: data.p || '0',
        change: data.c || '0',
      });
      tui.updateTickers(Array.from(state.tickers.entries()).map(([pair, info]) => [
        pair,
        info.price,
        info.change
      ]));
    }
  });

  ws.on('currentPrices@spot#update', (data) => {
    if (data && data.prices) {
      Object.entries(data.prices).forEach(([pair, price]: [string, any]) => {
        const existing = state.tickers.get(pair) || { price: '0', change: '0' };
        state.tickers.set(pair, { ...existing, price: price.toString() });
      });
      tui.updateTickers(Array.from(state.tickers.entries()).map(([pair, info]) => [
        pair,
        info.price,
        info.change
      ]));
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
