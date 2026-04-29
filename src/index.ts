import { TuiApp } from './tui/app';
import { CoinDCXWs } from './gateways/coindcx-ws';
import { CoinDCXApi } from './gateways/coindcx-api';
import { config } from './config/config';
import { formatPrice, formatPnl, formatChange, cleanPair, formatQty, formatTime } from './utils/format';
import { bootstrap } from './lifecycle/bootstrap';
import { installSignalHandlers } from './lifecycle/shutdown';
import type { Context } from './lifecycle/context';
import { IntegrityController } from './marketdata/integrity-controller';
import { AccountReconcileController } from './account/reconcile-controller';
import { AccountPersistence } from './account/persistence';
import { RestBudget } from './marketdata/rate-limit/rest-budget';
import { StrategyController } from './strategy/controller';
import { SmcRule } from './strategy/strategies/smc-rule';
import { MaCross } from './strategy/strategies/ma-cross';
import { LlmPulse } from './strategy/strategies/llm-pulse';
import { PassthroughRiskFilter } from './strategy/risk/risk-filter';
import { CompositeRiskFilter } from './strategy/risk/composite-filter';
import { MinConfidenceRule } from './strategy/risk/rules/min-confidence';
import { MaxConcurrentSignalsRule } from './strategy/risk/rules/max-concurrent-signals';
import { PerStrategyMaxPositionsRule } from './strategy/risk/rules/per-strategy-max-positions';
import { PerPairCooldownRule } from './strategy/risk/rules/cooldown';
import { OpposingPairCorrelationRule } from './strategy/risk/rules/correlation';
import { DrawdownGateRule } from './strategy/risk/rules/drawdown-gate';
import type { RiskFilter } from './strategy/types';
import type { Candle } from './ai/state-builder';
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

  // F6: Tap SignalBus emissions into TUI signals + risk panels
  const _origBusEmit = ctx.bus.emit.bind(ctx.bus);
  (ctx.bus as any).emit = async (s: any) => {
    try {
      tui.observeSignal(s);
      if (s && s.type && s.type.startsWith('strategy.')) {
        tui.log(`Bus emitted: ${s.type} for ${s.pair}`);
      }
    } catch (e: any) {
      tui.log(`TUI observer error: ${e.message}`);
    }
    return _origBusEmit(s);
  };

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

  // ── F3 Account Reconciler ──
  const accountPersistence = new AccountPersistence({ pool: ctx.pool, retryMax: 1000 });
  const accountBudget = new RestBudget({ globalPerMin: 60, pairPerMin: 60, timeoutMs: 1000 });
  const account = new AccountReconcileController({
    restApi: {
      getFuturesPositions: () => CoinDCXApi.getFuturesPositions(),
      getBalances: () => CoinDCXApi.getBalances(),
      getOpenOrders: () => CoinDCXApi.getOpenOrders(),
      getFuturesTradeHistory: opts => CoinDCXApi.getFuturesTradeHistory(opts),
    },
    persistence: accountPersistence,
    signalBus: ctx.bus,
    tryAcquireBudget: async () => {
      try { await accountBudget.acquire('account'); return true; } catch { return false; }
    },
    config: {
      driftSweepMs: ctx.config.ACCOUNT_DRIFT_SWEEP_MS,
      heartbeatFloors: {
        position: ctx.config.ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS,
        balance: ctx.config.ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS,
        order: ctx.config.ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS,
        fill: ctx.config.ACCOUNT_HEARTBEAT_FLOOR_FILL_MS,
      },
      pnlAlarmPct: ctx.config.ACCOUNT_PNL_ALARM_PCT,
      utilAlarmPct: ctx.config.ACCOUNT_UTIL_ALARM_PCT,
      divergencePnlAbsAlarm: ctx.config.ACCOUNT_DIVERGENCE_PNL_ABS_INR,
      divergencePnlPctAlarm: ctx.config.ACCOUNT_DIVERGENCE_PNL_PCT,
      backfillHours: ctx.config.ACCOUNT_BACKFILL_HOURS,
      signalCooldownMs: ctx.config.ACCOUNT_SIGNAL_COOLDOWN_MS,
      stormThreshold: ctx.config.ACCOUNT_STORM_THRESHOLD,
      stormWindowMs: ctx.config.ACCOUNT_STORM_WINDOW_MS,
    },
  });

  ws.on('depth-snapshot', (raw: any) => integrity.ingest('depth-snapshot', raw));
  ws.on('depth-update',   (raw: any) => integrity.ingest('depth-update',   raw));
  ws.on('new-trade',      (raw: any) => integrity.ingest('new-trade',      raw));
  ws.on('currentPrices@futures#update', (raw: any) => integrity.ingest('currentPrices@futures#update', raw));
  ws.on('currentPrices@spot#update',    (raw: any) => integrity.ingest('currentPrices@spot#update',    raw));

  // ── F4 Strategy Framework ──
  const candleStore = new Map<string, { ltf: Candle[]; htf: Candle[] }>();
  const ensureCandles = (pair: string) => {
    if (!candleStore.has(pair)) candleStore.set(pair, { ltf: [], htf: [] });
    return candleStore.get(pair)!;
  };
  const enabledIds = new Set(ctx.config.STRATEGY_ENABLED_IDS);
  const configuredPairs: string[] = ctx.config.COINDCX_PAIRS as unknown as string[];

  const buildRiskFilter = (): RiskFilter => {
    if (ctx.config.RISK_FILTER_MODE === 'passthrough') return new PassthroughRiskFilter();
    const cooldown = new PerPairCooldownRule(ctx.config.RISK_PER_PAIR_COOLDOWN_MS);
    const rules: import('./strategy/risk/rules/types').RiskRule[] = [
      new MinConfidenceRule(ctx.config.RISK_MIN_CONFIDENCE),
      new PerStrategyMaxPositionsRule(ctx.config.RISK_MAX_PER_STRATEGY_POSITIONS, 60_000),
      new MaxConcurrentSignalsRule(ctx.config.RISK_MAX_CONCURRENT_SIGNALS, 60_000),
      new DrawdownGateRule(ctx.config.RISK_DRAWDOWN_GATE_PCT),
    ];
    if (ctx.config.RISK_CORRELATION_BLOCK_OPPOSING) rules.push(new OpposingPairCorrelationRule(60_000));
    rules.push(cooldown);
    return new CompositeRiskFilter({
      rules,
      signalBus: ctx.bus,
      emitAlerts: ctx.config.RISK_ALERT_EMIT,
      liveTtlDefaultMs: 5 * 60_000,
    });
  };

  const strategyController = new StrategyController({
    ws,
    signalBus: ctx.bus,
    riskFilter: buildRiskFilter(),
    buildMarketState: (htf, ltf) => ctx.stateBuilder.build(htf, ltf, null, []),
    candleProvider: {
      ltf: pair => ensureCandles(pair).ltf,
      htf: pair => ensureCandles(pair).htf,
    },
    accountSnapshot: () => account.snapshot(),
    recentFills: (n = 20) => account.fills.recent(n),
    extractPair: (raw: any) => raw?.pair ?? raw?.s,
    config: {
      timeoutMs: ctx.config.STRATEGY_TIMEOUT_MS,
      errorThreshold: ctx.config.STRATEGY_ERROR_THRESHOLD,
      emitWait: true, // Force true for TUI visibility
      backpressureDropRatioAlarm: ctx.config.STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM,
    },
  });

  // Override star expansion to use configured pairs.
  (strategyController as any).expandStarPairs = () => configuredPairs;

  if (enabledIds.has('smc.rule.v1')) strategyController.register(new SmcRule());
  if (enabledIds.has('ma.cross.v1')) strategyController.register(new MaCross());
  if (enabledIds.has('llm.pulse.v1')) strategyController.register(new LlmPulse(ctx.analyzer));
  strategyController.start();

  setInterval(() => {
    tui.updateStatus({ lastUpdate: Date.now() });
    const focused = tui.focusedPair;
    const book = integrity.books.get(focused);
    tui.updateBookState(book ? book.state() : '—');
  }, 1000);

  const MAX_TRADES = 50;

  function log(msg: any) {
    if (typeof msg === 'string' && msg.startsWith('{')) {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'clock_skew') {
          const skew = data.payload?.localVsNtp || 0;
          tui.log(`{red-fg}{bold}[CRITICAL]{/bold} Clock Skew: ${skew}ms. Run 'sudo chronyc -a makestep' to sync.{/red-fg}`);
          return;
        }
        if (data.strategy === 'integrity') {
          tui.log(`{yellow-fg}[INTEGRITY] ${data.type}: ${data.payload?.reason || 'check failed'}{/yellow-fg}`);
          return;
        }
      } catch { /* fallback to raw */ }
    }
    tui.log(msg);
  }

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

  // ── AI Analysis & Strategy Data Loop ──
  setInterval(async () => {
    for (const rawPair of configuredPairs) {
      try {
        const symbol = cleanPair(rawPair);
        const [rawHtf, rawLtf] = await Promise.all([
          CoinDCXApi.getCandles(rawPair, '1h', 50),
          CoinDCXApi.getCandles(rawPair, '15m', 50)
        ]);
      const mapCandles = (raw: any) => (Array.isArray(raw) ? raw : []).map((c: any) => ({
        timestamp: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
        low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));
      const htfCandles = mapCandles(rawHtf);
      const ltfCandles = mapCandles(rawLtf);

      // F6: Populate candleStore so StrategyController can evaluate
      const store = ensureCandles(rawPair);
      store.htf = htfCandles;
      store.ltf = ltfCandles;

      const pulse = getMarketPulse();
      const marketState = ctx.stateBuilder.build(htfCandles, ltfCandles, pulse.orderBook, pulse.positions);

      if (marketState) {
        (marketState as any).symbol = symbol;
        tui.log(`{gray-fg}[AI] Sending ${symbol} snapshot to local brain...{/gray-fg}`);
        const analysis = await ctx.analyzer.analyze(marketState);
        tui.updateAi({
          verdict: String(analysis?.verdict ?? ''),
          signal: String(analysis?.signal ?? 'WAIT'),
          confidence: Number(analysis?.confidence ?? 0),
          no_trade_condition: analysis?.no_trade_condition ? String(analysis.no_trade_condition) : undefined,
          entry: analysis?.setup?.entry ? String(analysis.setup.entry) : undefined,
          stopLoss: analysis?.setup?.sl ? String(analysis.setup.sl) : undefined,
          takeProfit: analysis?.setup?.tp ? String(analysis.setup.tp) : undefined,
          rr: typeof analysis?.setup?.rr === 'number' ? analysis.setup.rr : undefined,
          pair: rawPair,
        });
        tui.log(`{green-fg}✓ [AI] Pulse updated for ${symbol}{/green-fg}`);
      } else {
        tui.log(`{yellow-fg}⚠ [AI] No candles for ${rawPair} (htf=${htfCandles.length} ltf=${ltfCandles.length}){/yellow-fg}`);
      }
    } catch (err: any) {
        ctx.logger.error({ mod: 'ai', err: err.message }, 'AI MTF loop failed');
        tui.log(`{red-fg}⚠ [AI] Analysis failed for ${rawPair}: ${err.message}{/red-fg}`);
      }
    }
  }, 15000); // 15s interval

  // ── Institutional Signal Sink ──
  class TuiSink {
    readonly name = 'tui';
    async emit(signal: any) {
      log(JSON.stringify(signal));
    }
  }

  // Inject TUI sink into the global bus
  const sinks = (ctx.bus as any).opts.sinks;
  if (Array.isArray(sinks)) {
    sinks.push(new TuiSink());
  }

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
    const rows = account.snapshot().positions
      .map(p => {
        const clean = cleanPair(p.pair || 'N/A');
        const sym = clean.replace('USDT', '');
        const ticker = state.tickers.get(clean);
        const currentPrice = ticker ? parseFloat(ticker.price) : parseFloat(p.markPrice ?? p.avgPrice);
        const entryPrice = parseFloat(p.avgPrice);
        const qty = Math.abs(parseFloat(p.activePos));
        const isLong = parseFloat(p.activePos) > 0;
        const pnl = isLong ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty;

        return [
          sym,
          isLong ? '{green-fg}LONG{/green-fg}' : '{red-fg}SHORT{/red-fg}',
          formatQty(qty),
          formatPrice(entryPrice),
          ticker ? formatPrice(ticker.price) : '—',
          formatPrice(p.markPrice ?? '0'),
          '—',
          formatPnl(pnl),
        ];
      });
    tui.updatePositions(rows.length > 0 ? rows : [['—', '—', '—', '—', '—', '—', '—', '—']]);
  }

  function refreshOrdersDisplay() {
    const rows = account.snapshot().orders
      .filter(o => o.status === 'open' || o.status === 'partially_filled')
      .map(o => {
        const sideChar = o.side === 'buy' ? '{green-fg}B{/green-fg}' : '{red-fg}S{/red-fg}';
        return [
          sideChar,
          cleanPair(o.pair || 'N/A'),
          (o.status || 'N/A').substring(0, 4).toUpperCase(),
          '—',
        ];
      });
    tui.updateOrders(rows.length > 0 ? rows : [['—', '—', '—', '—']]);
  }

  function refreshBalanceDisplay() {
    let totalEqInr = 0;
    let totalWalInr = 0;
    let totalPnlInr = 0;
    let totalPnlUsdt = 0;

    // 1. Sum up PnL from all positions dynamically (controller snapshot)
    account.snapshot().positions.forEach(p => {
       const clean = cleanPair(p.pair || '');
       const ticker = state.tickers.get(clean);
       const currentPrice = ticker ? parseFloat(ticker.price) : parseFloat(p.markPrice ?? p.avgPrice);
       const entryPrice = parseFloat(p.avgPrice);
       const qty = Math.abs(parseFloat(p.activePos));

       const isLong = parseFloat(p.activePos) > 0;
       const pnl = isLong ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty;

       const pair = (p.pair || '').toUpperCase();
       if (pair.endsWith('INR')) {
         totalPnlInr += pnl;
         totalPnlUsdt += pnl / (state.usdtInrRate || 88);
       } else {
         totalPnlUsdt += pnl;
         totalPnlInr += pnl * (state.usdtInrRate || 88);
       }
    });

    const rows: string[][] = [];

    // 2. Build rows from controller snapshot balances
    account.snapshot().balances
      .filter(b => parseFloat(b.available) > 0 || parseFloat(b.locked) > 0)
      .forEach(b => {
        const currency = b.currency;
        const available = parseFloat(b.available || '0');
        const locked = parseFloat(b.locked || '0');
        const walletBalance = available + locked;

        const isInrRow = currency === 'INR' || currency === 'USDTINR';
        const isUsdtRow = currency === 'USDT' || currency === 'USD';

        let rowPnl = 0;
        if (isInrRow) rowPnl = totalPnlInr;
        else if (isUsdtRow) rowPnl = totalPnlUsdt;

        const pnlInRowCurrency = isInrRow ? totalPnlInr : (isUsdtRow ? totalPnlUsdt : 0);
        const currentValue = walletBalance + pnlInRowCurrency;
        const pnlPct = walletBalance > 0 ? (rowPnl / walletBalance) * 100 : 0;
        const utilPct = walletBalance > 0 ? (locked / walletBalance) * 100 : 0;

        // Global Totals (INR)
        const inrValue = isInrRow ? currentValue : currentValue * state.usdtInrRate;
        const inrWallet = isInrRow ? walletBalance : walletBalance * state.usdtInrRate;
        totalEqInr += inrValue;
        totalWalInr += inrWallet;

        const prefix = isInrRow ? '₹' : (isUsdtRow ? '$' : '');
        rows.push([
          isInrRow ? '₹ INR' : currency,
          `${prefix}${formatQty(currentValue)}`,
          `${prefix}${formatQty(walletBalance)}`,
          formatPnl(rowPnl, prefix),
          `{${pnlPct >= 0 ? 'green' : 'red'}-fg}${pnlPct.toFixed(2)}%{/${pnlPct >= 0 ? 'green' : 'red'}-fg}`,
          `${prefix}${formatQty(available)}`,
          `${prefix}${formatQty(locked)}`,
          `{yellow-fg}${utilPct.toFixed(1)}%{/yellow-fg}`
        ]);

        // Virtual USD row below INR
        if (isInrRow && state.usdtInrRate > 0) {
          const usdEq = totalEqInr / state.usdtInrRate;
          const usdWal = totalWalInr / state.usdtInrRate;
          rows.push([
            '{cyan-fg}$ USD{/cyan-fg}',
            `{cyan-fg}$${formatQty(usdEq, 2)}{/cyan-fg}`,
            `{cyan-fg}$${formatQty(usdWal, 2)}{/cyan-fg}`,
            formatPnl(totalPnlUsdt, '$'),
            `{${totalPnlUsdt >= 0 ? 'green' : 'red'}-fg}${pnlPct.toFixed(2)}%{/${totalPnlUsdt >= 0 ? 'green' : 'red'}-fg}`,
            `{cyan-fg}$${formatQty(available / state.usdtInrRate, 2)}{/cyan-fg}`,
            `{cyan-fg}$${formatQty(locked / state.usdtInrRate, 2)}{/cyan-fg}`,
            `{yellow-fg}${utilPct.toFixed(1)}%{/yellow-fg}`
          ]);
        }
      });

    tui.updateBalances(rows.length > 0 ? rows : [['No balances', '—', '—', '—', '—', '—']]);

    // 3. Update Summary
    tui.updateSummary({
      equity: `₹${formatQty(totalEqInr)} (${formatQty(totalEqInr / state.usdtInrRate, 2)} USDT)`,
      wallet: `₹${formatQty(totalWalInr)} (${formatQty(totalWalInr / state.usdtInrRate, 2)} USDT)`,
      net: formatPnl(totalPnlInr, '₹'),
      unrealUsdt: `${formatQty(totalPnlUsdt, 2)} USDT`
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
      log('Fetching account balances...');
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
      log(`✓ Loaded ${state.balanceMap.size} balances`);
      refreshBalanceDisplay();
    } catch (err: any) {
      log(`⚠ Balance fetch failed: ${err.message}`);
      tui.updateBalances([['API error', err.message.substring(0, 30), '—', '—', '—', '—']]);
    }

    try {
      log('Fetching futures positions...');
      const posRaw = await CoinDCXApi.getFuturesPositions();
      const posArr = Array.isArray(posRaw) ? posRaw : (posRaw?.data || []);

      // Update Map
      state.positions.clear();
      posArr.forEach((p: any) => {
        if (p.id) state.positions.set(p.id, p);
      });

      refreshPositionsDisplay();
      refreshBalanceDisplay(); // Because PnL depends on positions
      log(`✓ Loaded ${state.positions.size} active positions`);
    } catch (err: any) {
      log(`⚠ Position fetch failed: ${err.message}`);
      tui.updatePositions([['API error', '—', '—', '—', '—', '—']]);
    }
  }

  // ══════════════════════════════════════════════════════
  // ── Initial REST API Fetch ──
  // ══════════════════════════════════════════════════════
  if (config.apiKey && config.apiSecret) {
    void fetchPrivateData();
    setInterval(fetchPrivateData, 5000); // 6x faster polling (5s instead of 30s)
  } else {
    log('⚠ API Key/Secret missing — PUBLIC ONLY mode');
    state.hasValidAuth = false;
    tui.updateBalances([['No API key', '—', '—', '—', '—', '—']]);
    tui.updatePositions([['No API key', '—', '—', '—', '—', '—']]);
  }
  // ── WebSocket Logic ──
  // ══════════════════════════════════════════════════════

  ws.on('connected', () => {
    state.isWsConnected = true;
    log('✓ WebSocket connected');
    tui.updateStatus({ connected: true });
    ctx.audit.recordEvent({ kind: 'ws_reconnect', source: 'ws', payload: {} });
  });
  ws.on('disconnected', (reason) => {
    state.isWsConnected = false;
    log(`✗ Disconnected: ${reason}`);
    tui.updateStatus({ connected: false });
  });
  ws.on('error', (error) => {
    log(`✗ WS error: ${error.message}`);
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

    // F4: notify bar driver of trade timestamp
    const tradeTs = Number(data.T ?? Date.now());
    if (Number.isFinite(tradeTs)) strategyController.notifyTrade(pair, tradeTs);

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
    refreshPositionsDisplay(); // Reactive PnL update
    refreshBalanceDisplay();   // Reactive Equity update
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
    log(`Position update: ${positions.length} received`);

    positions.forEach((p: any) => {
      if (p.id) {
        state.positions.set(p.id, p);
      }
      void account.ingest('position', p);
    });

    refreshPositionsDisplay();
    refreshBalanceDisplay(); // Update PnL in balance
  });

  // ── df-order-update: [{ pair, side, status, price, total_quantity, ... }] ──
  ws.on('df-order-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const orders = Array.isArray(data) ? data : [data];
    log(`Order update: ${orders.length} received`);

    orders.forEach((o: any) => {
      if (o.id) {
        if (o.status === 'open' || o.status === 'partially_filled') {
          state.orders.set(o.id, o);
        } else {
          state.orders.delete(o.id);
        }
      }
      void account.ingest('order', o);
    });

    refreshOrdersDisplay();
  });

  // ── df-trade-update: [{ id, order_id, pair, side, price, quantity, executed_at }] ──
  ws.on('df-trade-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const fills = Array.isArray(data) ? data : [data];
    fills.forEach((f: any) => { void account.ingest('fill', f); });
  });

  // ── balance-update: [{ balance, locked_balance, currency_short_name }] ──
  ws.on('balance-update', (raw) => {
    const data = safeParse(raw);
    if (!data) return;
    const balances = Array.isArray(data) ? data : [data];
    log(`Balance update: ${balances.length} assets`);

    balances.forEach((b: any) => {
      const name = b.currency_short_name || b.currency || 'N/A';
      state.balanceMap.set(name, {
        balance: b.balance?.toString() || '0',
        locked: (b.locked_balance ?? '0').toString(),
      });
      void account.ingest('balance', b);
    });
    refreshBalanceDisplay();
  });

  // ── F3 boot: seed + start; reconnect triggers forced sweep ──
  let accountStarted = false;
  if (config.apiKey && config.apiSecret) {
    try {
      await account.seed();
      account.start();
      accountStarted = true;
      log(`✓ Account reconciler started (positions=${account.snapshot().positions.length}, balances=${account.snapshot().balances.length})`);
    } catch (err: any) {
      log(`⚠ Account reconciler seed failed: ${err.message}`);
    }
  }
  ws.on('connected', () => {
    if (accountStarted) void account.onWsReconnect();
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
      log(`Refresh error: ${err.message}`);
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
