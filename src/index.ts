import { TuiApp } from './tui/app';
import { CoinDCXWs } from './gateways/coindcx-ws';
import { CoinDCXApi } from './gateways/coindcx-api';
import { config } from './config/config';
import { formatPrice, formatPnl, formatChange, cleanPair, formatQty, formatTime } from './utils/format';
import { bootstrap } from './lifecycle/bootstrap';
import { installSignalHandlers } from './lifecycle/shutdown';
import type { Context } from './lifecycle/context';
import { IntegrityController } from './marketdata/integrity-controller';
import { CoinDcxFusion } from './marketdata/coindcx-fusion';
import { AccountReconcileController } from './account/reconcile-controller';
import { AccountPersistence } from './account/persistence';
import { RestBudget } from './marketdata/rate-limit/rest-budget';
import { StrategyController } from './strategy/controller';
import { SmcRule } from './strategy/strategies/smc-rule';
import { MaCross } from './strategy/strategies/ma-cross';
import { LlmPulse } from './strategy/strategies/llm-pulse';
import { BearishSmc } from './strategy/strategies/bearish-smc';
import { PassthroughRiskFilter } from './strategy/risk/risk-filter';
import { CompositeRiskFilter } from './strategy/risk/composite-filter';
import { MinConfidenceRule } from './strategy/risk/rules/min-confidence';
import { MaxConcurrentSignalsRule } from './strategy/risk/rules/max-concurrent-signals';
import { PerStrategyMaxPositionsRule } from './strategy/risk/rules/per-strategy-max-positions';
import { PerPairCooldownRule } from './strategy/risk/rules/cooldown';
import { OpposingPairCorrelationRule } from './strategy/risk/rules/correlation';
import { DrawdownGateRule } from './strategy/risk/rules/drawdown-gate';
import type { RiskFilter } from './strategy/types';
import type { Candle, BookSnapshot } from './ai/state-builder';
import { MultiTimeframeStore as CandleMtfStore, DEFAULT_TF_CONFIGS } from './marketdata/candles/multi-timeframe-store';
import type { OrderBook } from './marketdata/book/orderbook';
import type { IntentMarketContext } from './execution/intent-validator';
import type { RegimeFeatures } from './runtime/regime-classifier';
import { RuntimeWorkerSet } from './runtime/workers/runtime-workers';
import { RuntimePersistence } from './persistence/runtime-persistence';
import { TradePersistence } from './persistence/trade-persistence';
import { OrderbookPersistence } from './persistence/orderbook-persistence';
import { ProbabilityAnalyticsRepository } from './runtime/probability-analytics';
import {
  shouldAllowNegativeClose,
  type NegativeCloseContext,
} from './runtime/negative-close-policy';
import ntp from 'ntp-client';
import axios from 'axios';
import { estimateSyntheticFundingRate, resolveMarkPrice, resolveOpenInterest } from './marketdata/data-gap-policy';

// ── Types ──
interface TickerInfo {
  price: string;
  markPrice: string;
  change: string;
  openInterest?: string;
  syntheticFundingRate?: string;
  basis?: string;
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
  hasValidAuth: true,
  usdtInrRate: 88.5, // Fallback rate
  selectedSymbol: 'SOLUSDT' // Initial focus
};

// ══════════════════════════════════════════════════════
// ── Helpers ──
// ══════════════════════════════════════════════════════

/** Extract bid/ask metrics from an L2 OrderBook for strategy context. */
function computeBookSnapshot(book: OrderBook): BookSnapshot {
  const top = book.topN(20);
  const bestBid = parseFloat(top.bids[0]?.price ?? '0');
  const bestAsk = parseFloat(top.asks[0]?.price ?? '0');
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;

  // Depth within 1% of best price
  const bidDepth = top.bids
    .filter(l => bestBid > 0 && parseFloat(l.price) >= bestBid * 0.99)
    .reduce((s, l) => s + parseFloat(l.qty), 0);
  const askDepth = top.asks
    .filter(l => bestAsk > 0 && parseFloat(l.price) <= bestAsk * 1.01)
    .reduce((s, l) => s + parseFloat(l.qty), 0);

  // Largest single level (wall)
  const bidWall = top.bids.reduce<{ price: string; qty: string } | undefined>(
    (mx, l) => (!mx || parseFloat(l.qty) > parseFloat(mx.qty) ? l : mx), undefined,
  );
  const askWall = top.asks.reduce<{ price: string; qty: string } | undefined>(
    (mx, l) => (!mx || parseFloat(l.qty) > parseFloat(mx.qty) ? l : mx), undefined,
  );

  const imbalance: BookSnapshot['imbalance'] =
    bidDepth > askDepth * 1.2 ? 'bid-heavy' :
    askDepth > bidDepth * 1.2 ? 'ask-heavy' :
    'neutral';

  return {
    bestBid,
    bestAsk,
    spread,
    bidDepth1pct: bidDepth,
    askDepth1pct: askDepth,
    imbalance,
    bidWallPrice: bidWall ? parseFloat(bidWall.price) : null,
    askWallPrice: askWall ? parseFloat(askWall.price) : null,
  };
}

/** Determine simple trend from last N candles. */
function candleTrend(candles: Candle[], n = 3): 'up' | 'down' | 'sideways' {
  if (candles.length < n) return 'sideways';
  const slice = candles.slice(-n);
  const higherHighs = slice.every((c, i) => i === 0 || c.high >= slice[i - 1].high);
  const higherLows  = slice.every((c, i) => i === 0 || c.low  >= slice[i - 1].low);
  const lowerHighs  = slice.every((c, i) => i === 0 || c.high <= slice[i - 1].high);
  const lowerLows   = slice.every((c, i) => i === 0 || c.low  <= slice[i - 1].low);
  if (higherHighs && higherLows) return 'up';
  if (lowerHighs  && lowerLows)  return 'down';
  return 'sideways';
}

function parseFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readSignalMeta(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const metaUnknown = (payload as Record<string, unknown>).meta;
  if (!metaUnknown || typeof metaUnknown !== 'object' || Array.isArray(metaUnknown)) return undefined;
  return metaUnknown as Record<string, unknown>;
}

function pickFirstFinite(meta: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = parseFiniteNumber(meta[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function buildRuntimeMarketContext(pair: string): IntentMarketContext {
  const ticker = state.tickers.get(pair) ?? state.tickers.get(cleanPair(pair));
  const markPrice = ticker?.markPrice || ticker?.price;
  const accountSnapshot = Array.from(state.positions.values()).find(
    (position: any) => cleanPair(position?.pair) === cleanPair(pair) && Number(position?.active_pos ?? 0) !== 0,
  );
  const liquidationPrice = accountSnapshot?.liquidation_price;
  const leverage = accountSnapshot?.leverage;
  const marketDataFresh =
    state.lastPriceUpdate > 0
      ? (Date.now() - state.lastPriceUpdate) <= 30_000
      : undefined;
  return {
    ...(markPrice ? { markPrice } : {}),
    ...(liquidationPrice ? { liquidationPrice } : {}),
    ...(leverage ? { leverage } : {}),
    ...(ticker?.openInterest ? { maxLeverage: ticker.openInterest } : {}),
    marketDataFresh,
    accountStateFresh: state.hasValidAuth,
    accountDivergent: false,
  };
}

function buildRuntimeRegimeFeatures(payload: unknown): RegimeFeatures {
  const meta = readSignalMeta(payload);
  if (!meta) return {};
  const adx4h = pickFirstFinite(meta, ['adx4h', 'ADX_4H', 'adx_4h']);
  const atrPercentile = pickFirstFinite(meta, ['atrPercentile', 'ATR_PCTL', 'atr_pctl']);
  const bbWidthPercentile = pickFirstFinite(meta, ['bbWidthPercentile', 'BB_WIDTH_PCTL', 'bb_width_pctl']);
  const mssSignal = meta.hasMarketStructureShift ?? meta.marketStructureShift ?? meta.MSS_4H ?? meta.mss_4h;
  const mssNumeric = parseFiniteNumber(mssSignal);
  const hasMarketStructureShift = mssSignal === true || (mssNumeric !== undefined && mssNumeric > 0);
  return {
    ...(adx4h !== undefined ? { adx4h } : {}),
    ...(atrPercentile !== undefined ? { atrPercentile } : {}),
    ...(bbWidthPercentile !== undefined ? { bbWidthPercentile } : {}),
    hasMarketStructureShift,
  };
}

function inferRuntimeMicrostructureContribution(payload: unknown): number | undefined {
  const meta = readSignalMeta(payload);
  if (!meta) return undefined;
  const raw =
    meta.microstructureContribution ??
    meta.bookImbalanceContribution ??
    meta.orderFlowContribution;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(-1, Math.min(1, raw));
  }
  return undefined;
}

function buildRuntimeConfluenceComponents(payload: unknown): Record<string, number> | undefined {
  const meta = readSignalMeta(payload);
  if (!meta) return undefined;
  const sourceUnknown = meta.confluenceComponents;
  const source =
    sourceUnknown && typeof sourceUnknown === 'object' && !Array.isArray(sourceUnknown)
      ? sourceUnknown as Record<string, unknown>
      : meta;
  const confidence = pickFirstFinite(source, ['confidenceContribution']);
  const structure = pickFirstFinite(source, ['structureContribution']);
  const momentum = pickFirstFinite(source, ['momentumContribution']);
  const microstructure = pickFirstFinite(source, [
    'microstructureContribution',
    'bookImbalanceContribution',
    'orderFlowContribution',
  ]);
  const risk = pickFirstFinite(source, ['riskContribution']);
  const entries = Object.entries({
    ...(confidence !== undefined ? { confidence } : {}),
    ...(structure !== undefined ? { structure } : {}),
    ...(momentum !== undefined ? { momentum } : {}),
    ...(microstructure !== undefined ? { microstructure } : {}),
    ...(risk !== undefined ? { risk } : {}),
  }).map(([component, value]) => [component, Math.max(-1, Math.min(1, value))] as const);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

// ══════════════════════════════════════════════════════
// ── Main ──
// ══════════════════════════════════════════════════════
async function runApp(ctx: Context) {
  const tui = new TuiApp();
  const ws = new CoinDCXWs();
  const runtimePersistence = new RuntimePersistence(ctx.pool);
  const tradePersistence = new TradePersistence(ctx.pool);
  const orderbookPersistence = new OrderbookPersistence(ctx.pool);
  const probabilityAnalytics = new ProbabilityAnalyticsRepository(ctx.pool);
  const trackOpenedAtByPair = new Map<string, string>();
  ctx.logger.info({ mod: 'app' }, 'app start');

  // F6: Tap SignalBus emissions into TUI signals + risk panels
  const _origBusEmit = ctx.bus.emit.bind(ctx.bus);
  (ctx.bus as any).emit = async (s: any) => {
    try {
      tui.observeSignal(s);
      if (s?.type && s?.pair && (s.type === 'strategy.long' || s.type === 'strategy.short')) {
        const decision = ctx.runtime.process(s, {
          market: buildRuntimeMarketContext(s.pair),
          regimeFeatures: buildRuntimeRegimeFeatures(s.payload),
          defaultEntryType: 'limit',
          confluenceComponents: buildRuntimeConfluenceComponents(s.payload),
          microstructureContribution: inferRuntimeMicrostructureContribution(s.payload),
          tradePlanOverrides: {
            accountEquity: ctx.config.TRADEPLAN_ACCOUNT_EQUITY,
            riskCapitalFraction: ctx.config.TRADEPLAN_RISK_CAPITAL_FRACTION,
            atrPercent: ctx.config.TRADEPLAN_ATR_BUFFER_MULTIPLIER * 0.01,
            feeRate: ctx.config.TRADEPLAN_FEE_RATE,
            fundingRate: ctx.config.TRADEPLAN_FUNDING_RATE_BUFFER,
            maxVenueLeverage: ctx.config.TRADEPLAN_HARD_MAX_LEVERAGE,
            liquidationBufferMultiplier: ctx.config.TRADEPLAN_LIQUIDATION_BUFFER_MULTIPLIER,
          },
        });
        if (decision) {
          const probability = decision.confluence.fireGatePassed
            ? await probabilityAnalytics.snapshot({
              regime: decision.regime.regime,
              maxScore: decision.confluence.maxScore,
            })
            : undefined;
          const payload = {
            ...(s.payload ?? {}),
            ...(probability ? { probability } : {}),
            confluence: {
              longScore: decision.confluence.longScore,
              shortScore: decision.confluence.shortScore,
              maxScore: decision.confluence.maxScore,
              scoreSpread: decision.confluence.scoreSpread,
              fireGatePassed: decision.confluence.fireGatePassed,
              volatileExceptionApplied: decision.confluence.volatileExceptionApplied,
            },
            regime: {
              value: decision.regime.regime,
              changed: decision.regime.changed,
              previousRegime: decision.regime.previousRegime,
              classifiedAt: decision.regime.classifiedAt,
            },
            ...(decision.tradePlan
              ? {
                tradePlan: {
                  side: decision.tradePlan.side,
                  entry: decision.tradePlan.entry,
                  stopLoss: decision.tradePlan.stopLoss,
                  leverage: decision.tradePlan.leverage,
                  quantity: decision.tradePlan.quantity,
                  riskCapital: decision.tradePlan.riskCapital,
                  targets: decision.tradePlan.targets,
                  breakevenPlus: decision.tradePlan.breakevenPlus,
                  liquidationBufferSatisfied: decision.tradePlan.liquidationBufferSatisfied,
                  metadata: decision.tradePlan.metadata,
                },
              }
              : {}),
          };
          s.payload = payload;
        }
        if (decision?.status === 'blocked' && !decision.riskDecision.approved) {
          ctx.logger.debug(
            {
              mod: 'runtime',
              pair: decision.pair,
              status: decision.status,
              rejections: decision.riskDecision.rejections.map((rejection) => rejection.code),
            },
            'runtime pipeline blocked intent',
          );
        }
        if (decision?.status === 'routed') {
          ctx.logger.debug(
            {
              mod: 'runtime',
              pair: decision.pair,
              status: decision.status,
              route: decision.routedOrder.route,
            },
            'runtime pipeline routed intent',
          );
          await runtimePersistence.persistPaperTrade(decision.routedOrder);
        }
      }
      if (s?.type && runtimePersistence.isSignalEligible(s)) {
        await runtimePersistence.persistSignal(s);
      } else if (s?.type && runtimePersistence.isRiskEventEligible(s)) {
        await runtimePersistence.persistRiskEvent(s);
        await runtimePersistence.persistPositionSnapshot(s);
      }
      if (s && s.type && s.type.startsWith('strategy.')) {
        tui.log(`Bus emitted: ${s.type} for ${s.pair}`);
      }
    } catch (e: any) {
      tui.log(`TUI observer error: ${e.message}`, 'error');
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

  // fusion constructed after mtfStore (see below) to share single canonical candle store

  // ── F3 Account Reconciler ──
  const accountPersistence = new AccountPersistence({
    pool: ctx.pool,
    retryMax: 1000,
    onError: (err, op, depth) => ctx.logger.warn({ mod: 'persistence', op, depth, err: err.message }, 'persistence write failed; queued for retry'),
    onQueueOverflow: (dropped, depth) => ctx.logger.error({ mod: 'persistence', dropped, depth }, 'persistence retry queue overflow; events lost'),
  });
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

  ws.on('depth-snapshot', (raw: any) => {
    integrity.ingest('depth-snapshot', safeParse(raw));
    const parsed = safeParse(raw);
    const pair = parsed?.s ?? parsed?.pair;
    if (typeof pair === 'string') {
      void orderbookPersistence.persistSnapshot(integrity.books, pair, 'depth-snapshot', new Date().toISOString());
      void orderbookPersistence.persistArtifact({
        pair,
        channel: 'depth-snapshot',
        kind: 'ws_frame',
        ts: new Date().toISOString(),
        exchangeTs: Number(parsed?.T ?? parsed?.E),
        payload: parsed,
      });
    }
    refreshBookDisplay();
  });
  ws.on('depth-update', (raw: any) => {
    integrity.ingest('depth-update', safeParse(raw));
    const parsed = safeParse(raw);
    const pair = parsed?.s ?? parsed?.pair;
    if (typeof pair === 'string') {
      void orderbookPersistence.persistArtifact({
        pair,
        channel: 'depth-update',
        kind: 'ws_frame',
        ts: new Date().toISOString(),
        exchangeTs: Number(parsed?.T ?? parsed?.E),
        payload: parsed,
      });
    }
    refreshBookDisplay();
  });
  integrity.books.on('gap', (event: any) => {
    ctx.audit.recordEvent({
      kind: 'orderbook_gap',
      source: 'integrity.book',
      payload: {
        pair: event?.pair,
        reason: event?.reason,
        expected: event?.expected,
        prevSeq: event?.prevSeq,
        price: event?.price,
      },
    });
    void orderbookPersistence.persistArtifact({
      pair: event?.pair,
      channel: 'depth-update',
      kind: 'orderbook_gap',
      ts: new Date().toISOString(),
      payload: {
        reason: event?.reason,
        expected: event?.expected,
        prevSeq: event?.prevSeq,
        price: event?.price,
      },
    });
  });
  ws.on('new-trade',      (raw: any) => integrity.ingest('new-trade',      safeParse(raw)));
  ws.on('currentPrices@futures#update', (raw: any) => integrity.ingest('currentPrices@futures#update', safeParse(raw)));
  ws.on('currentPrices@spot#update',    (raw: any) => integrity.ingest('currentPrices@spot#update',    safeParse(raw)));

  // ── F4 Strategy Framework ──
  const enabledIds = new Set(ctx.config.STRATEGY_ENABLED_IDS);
  const configuredPairs: string[] = ctx.config.COINDCX_PAIRS as unknown as string[];

  /** Fetch candles from REST, normalise to Candle[], oldest-first. */
  async function fetchCandlesForStore(pair: string, tf: string, limit: number): Promise<Candle[]> {
    const raw = await CoinDCXApi.getCandles(pair, tf, limit);
    if (!Array.isArray(raw)) return [];
    return raw.map((c: any) => ({
      timestamp: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  }

  const mtfStore = new CandleMtfStore({
    configs: DEFAULT_TF_CONFIGS,
    fetchCandles: fetchCandlesForStore,
    logger: ctx.logger,
  });

  const tradeFlow = new (await import('./marketdata/trade-flow')).TradeFlow();
  const fusion = new CoinDcxFusion(ctx.logger.child({ mod: 'fusion' }), ws as any, mtfStore, integrity.books, tradeFlow);
  fusion.on('fusion', (snap) => {
    if (snap.pair === getFocusedCleanPair() || snap.pair === tui.focusedPair) {
      refreshBookDisplay();
    }
  });

  // Seed all configured pairs in parallel
  await Promise.all(
    configuredPairs.map(async (rawPair) => {
      try {
        await mtfStore.seed(rawPair);
        const ltfCount = mtfStore.get(rawPair, '15m').length;
        const htfCount = mtfStore.get(rawPair, '1h').length;
        tui.log(`{gray-fg}[MTF] Seeded ${cleanPair(rawPair)}: 1m=${mtfStore.get(rawPair, '1m').length} 15m=${ltfCount} 1h=${htfCount}{/gray-fg}`);
      } catch (err: any) {
        tui.log(`{red-fg}⚠ [MTF] Seed failed for ${rawPair}: ${err.message}{/red-fg}`, 'error');
      }
    }),
  );

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
    buildMarketState: (htf, ltf, pair) => {
      const book = integrity.books.get(pair);
      const bookSnap = book && book.state() === 'live' ? computeBookSnapshot(book) : null;
      return ctx.stateBuilder.build(htf, ltf, bookSnap, fusion.getLatest(pair), [], pair);
    },
    candleProvider: {
      ltf: pair => mtfStore.get(pair, '15m'),
      htf: pair => mtfStore.get(pair, '1h'),
    },
    fusionProvider: pair => fusion.getLatest(pair),
    accountSnapshot: () => account.snapshot(),
    recentFills: (n = 20) => account.fills.recent(n),
    extractPair: (raw: any) => raw?.pair ?? raw?.s,
    beforeEvaluate: async (id, pair, _trigger) => {
      if (id === 'llm.pulse.v1') {
        tui.updateAi({
          verdict: ' {yellow-fg}Analyzing market pulse...{/yellow-fg}',
          signal: 'WAIT',
          confidence: 0,
          pair,
        });
      }
    },
    onEvaluatedSignal: (signal, manifest, pair) => {
      if (manifest.id !== 'llm.pulse.v1') return;
      tui.updateAi({
        verdict: signal.reason,
        signal: signal.side,
        confidence: signal.confidence,
        no_trade_condition: signal.noTradeCondition,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        rr: typeof signal.meta?.rr === 'number' ? signal.meta.rr : undefined,
        levels: Array.isArray(signal.meta?.levels) ? signal.meta.levels : undefined,
        pair,
      });
    },
    config: {
      timeoutMs: ctx.config.STRATEGY_TIMEOUT_MS,
      errorThreshold: ctx.config.STRATEGY_ERROR_THRESHOLD,
      emitWait: true, // Force true for TUI visibility
      backpressureDropRatioAlarm: ctx.config.STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM,
    },
  });

  // Override star expansion to use configured pairs.
  (strategyController as any).expandStarPairs = () => configuredPairs;

  if (enabledIds.has('smc.rule.v1'))    strategyController.register(new SmcRule());
  if (enabledIds.has('ma.cross.v1'))    strategyController.register(new MaCross());
  if (enabledIds.has('llm.pulse.v1'))   strategyController.register(new LlmPulse(ctx.analyzer));
  if (enabledIds.has('bearish.smc.v1')) strategyController.register(new BearishSmc());
  strategyController.start();

  const runtimeWorkers = new RuntimeWorkerSet({
    config: ctx.config,
    logger: ctx.logger,
    pairs: configuredPairs,
    getPositions: () => account.snapshot().positions,
    getMarkPrice: (pair) => {
      const ticker = state.tickers.get(pair) ?? state.tickers.get(cleanPair(pair));
      const raw = ticker?.markPrice ?? ticker?.price;
      const parsed = raw !== undefined ? Number(raw) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : undefined;
    },
    onCandleClose: async ({ pair, timeframe }) => {
      for (const manifest of strategyController.registry.list()) {
        if (manifest.mode !== 'bar_close') continue;
        const allowedTimeframes = manifest.barTimeframes ?? ['1m'];
        if (!allowedTimeframes.includes(timeframe)) continue;
        if (!manifest.pairs.includes('*') && !manifest.pairs.includes(pair)) continue;
        await strategyController.runOnce(manifest.id, pair, { kind: 'bar_close', tf: timeframe });
      }
    },
    onBreakevenArm: async ({ pair, positionId, markPrice, avgPrice, side }) => {
      ctx.logger.info(
        {
          mod: 'worker.breakeven',
          pair,
          positionId,
          side,
          markPrice,
          avgPrice,
        },
        'breakeven protection armed',
      );
    },
    onFundingWindow: async ({ windowIso, leadMs }) => {
      ctx.logger.info(
        {
          mod: 'worker.funding',
          windowIso,
          leadMs,
        },
        'funding pre-window ticker fired',
      );
      if (!enabledIds.has('llm.pulse.v1')) return;
      for (const rawPair of configuredPairs) {
        await strategyController.runOnce('llm.pulse.v1', rawPair, { kind: 'interval' });
      }
    },
  });
  runtimeWorkers.start();
  ctx.runtimeWorkers = runtimeWorkers;

  setInterval(() => {
    tui.updateStatus({ lastUpdate: Date.now() });
    const focused = tui.focusedPair;
    const book = integrity.books.get(focused);
    tui.updateBookState(book ? book.state() : '—');
  }, 1000);

  /** Push fresh MTF + book metrics into the TUI AI panel for the given pair. */
  function pushMtfToTui(pair: string): void {
    const c1m  = mtfStore.get(pair, '1m');
    const c15m = mtfStore.get(pair, '15m');
    const c1h  = mtfStore.get(pair, '1h');
    const last1m  = c1m[c1m.length - 1];
    const last15m = c15m[c15m.length - 1];
    const last1h  = c1h[c1h.length - 1];

    const book = integrity.books.get(pair);
    const snap = book && book.state() === 'live' ? computeBookSnapshot(book) : undefined;

    tui.updateMtf({
      pair,
      tf1m:  last1m  ? { close: last1m.close,  volume: last1m.volume,  trend: candleTrend(c1m) }  : undefined,
      tf15m: last15m ? { close: last15m.close, volume: last15m.volume, trend: candleTrend(c15m) } : undefined,
      tf1h:  last1h  ? { close: last1h.close,  volume: last1h.volume,  trend: candleTrend(c1h) }  : undefined,
      bookImbalance: snap?.imbalance,
      bestBid: snap?.bestBid,
      bestAsk: snap?.bestAsk,
      spread: snap?.spread,
    });
  }

  // ── WS candlestick → MTF store (registered here, after mtfStore is initialized) ──
  // CoinDCX fires `candlestick` with response.data = [{open,close,high,low,volume,open_time,pair,duration,...}]
  ws.on('candlestick', (raw: any) => {
    const candles = Array.isArray(raw) ? raw : [];
    for (const c of candles) {
      if (!c.pair || !c.duration) continue;
      mtfStore.applyWsCandle(c.pair, c.duration as string, c);
    }
  });

  // Push MTF panel updates whenever a candle bar arrives for the focused pair
  mtfStore.on('update', ({ pair }: { pair: string }) => {
    if (pair === tui.focusedPair) pushMtfToTui(pair);
  });

  // Also push on focus change so switching pairs immediately shows current data
  tui.setOnFocusChange((pair: string) => {
    refreshBookDisplay();
    refreshHeader();
    pushMtfToTui(pair);
  });

  // Paint the MTF panel immediately with seeded data so it's not blank at startup
  pushMtfToTui(tui.focusedPair);

  const MAX_TRADES = 50;

  function log(msg: any) {
    if (typeof msg === 'string') {
      if (msg.startsWith('{') && msg.includes('"type"')) {
        try {
          const data = JSON.parse(msg);
          // Legacy/Fallback parsing for non-sink JSON logs
          if (data.type === 'clock_skew') {
             tui.log(`{yellow-fg}[TIME] Sync Alert: ${data.payload?.reason || 'unstable'}{/yellow-fg}`, 'warn');
             return;
          }
        } catch { /* ignore and log raw */ }
      }
      tui.log(msg);
    } else {
      tui.log(JSON.stringify(msg));
    }
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

  function logCandleStatus(): void {
    for (const rawPair of configuredPairs) {
      const symbol = cleanPair(rawPair);
      const c1m  = mtfStore.get(rawPair, '1m').length;
      const c15m = mtfStore.get(rawPair, '15m').length;
      const c1h  = mtfStore.get(rawPair, '1h').length;
      if (c15m > 0 && c1h > 0) {
        tui.log(`{gray-fg}[MTF] ${symbol}: 1m=${c1m} 15m=${c15m} 1h=${c1h}{/gray-fg}`);
      } else {
        tui.log(`{red-fg}⚠ [MTF] No candles for ${rawPair} (1m=${c1m} 15m=${c15m} 1h=${c1h}){/red-fg}`, 'error');
      }
    }
  }

  async function seedInitialAiPulse(): Promise<void> {
    if (!enabledIds.has('llm.pulse.v1')) return;
    tui.log(`{gray-fg}[AI] Starting initial analysis for ${configuredPairs.length} pairs...{/gray-fg}`);
    
    await Promise.all(configuredPairs.map(async (rawPair) => {
      try {
        await strategyController.runOnce('llm.pulse.v1', rawPair, { kind: 'interval' });
        tui.log(`{cyan-fg}[AI] Initial analysis complete for ${rawPair}{/cyan-fg}`);
      } catch (err: any) {
        tui.log(`{red-fg}⚠ [AI] Initial analysis failed for ${rawPair}: ${err.message}{/red-fg}`, 'error');
      }
    }));
  }

  // ── Strategy Market Data Loop ──
  logCandleStatus();
  void seedInitialAiPulse();

  // ── Institutional Signal Sink ──
  class TuiSink {
    readonly name = 'tui';
    async emit(signal: any) {
      const type = signal.type || 'unknown';
      const payload = signal.payload || {};
      const pair = cleanPair(signal.pair || '—');
      const side = (type.split('.')[1] || 'WAIT').toUpperCase();

      // 1. Filter out WAIT signals to reduce noise
      if (side === 'WAIT' && !type.includes('error')) return;

      // 2. Format based on type
      let icon = '⚪';
      let color = 'white';
      let msg = '';

      if (type.startsWith('strategy.')) {
        if (type.includes('error')) {
          icon = '🔴';
          color = 'red';
          msg = `[${signal.strategy}] ERROR: ${payload.error || payload.reason || 'Unknown error'}`;
        } else {
          icon = side === 'LONG' ? '🟢' : '🔴';
          color = side === 'LONG' ? 'green' : 'red';
          const entry = payload.entry ? ` @ ${formatPrice(payload.entry)}` : '';
          const conf = payload.confidence ? ` (Conf: ${(payload.confidence * 100).toFixed(0)}%)` : '';
          const mgmt = payload.meta?.management ? ` | [MGMT: ${payload.meta.management}]` : '';
          msg = `[${signal.strategy}] ${side} ${pair}${entry}${conf}${mgmt} - ${payload.reason || ''}`;
        }
      } else if (type === 'risk.blocked') {
        icon = '🟡';
        color = 'yellow';
        const rules = Array.isArray(payload.rules) ? payload.rules.map((r: any) => r.id).join(', ') : 'unknown';
        msg = `[RISK] BLOCKED ${side} ${pair} - Reason: ${rules}`;
      } else if (type.includes('reconcile')) {
        // Internal technical events - typically unhelpful for traders unless critical
        if (payload.severity === 'critical') {
          icon = '🔴';
          color = 'red';
          msg = `[ACCOUNT] ALERT: ${payload.reason || ''}`;
        } else {
          return; // Suppress info/warn reconciler noise
        }
      } else if (signal.strategy === 'integrity' || type === 'clock_skew') {
        // Only show clock skew if it is critical (will break authentication)
        if (payload.severity !== 'critical') return;
        
        icon = '🔴';
        color = 'red';
        const reason = payload.reason || payload.error || 'Skew exceeded';
        msg = `[INTEGRITY] ${type.toUpperCase()}: ${reason}`;
      } else {
        // Fallback for other signals
        return; 
      }

      log(`{${color}-fg}${icon} ${msg}{/${color}-fg}`);
    }
  }

  // Inject TUI sink into the global bus
  const sinks = (ctx.bus as any).opts.sinks;
  if (Array.isArray(sinks)) {
    sinks.push(new TuiSink());
  }

  function refreshBookDisplay() {
    const focused = getFocusedCleanPair();
    const rawPair = tui.focusedPair; 
    const book = integrity.books.get(rawPair);
    const ticker = state.tickers.get(focused);
    const snap = fusion.getLatest(rawPair);

    if (!book) {
       tui.updateOrderBook([], [], ticker?.price || '—', rawPair);
       return;
    }

    const formatBookRow = (price: string, qty: string, cumulative: number) => [
      formatPrice(price),
      formatQty(parseFloat(price) * parseFloat(qty)), // Amount in INR
      formatQty(cumulative) // Cumulative in INR
    ];

    let askCumulative = 0;
    const asks = Array.from(book.topN(10).asks)
      .map(l => {
         const p = l.price;
         const q = l.qty;
         askCumulative += parseFloat(p) * parseFloat(q);
         return formatBookRow(p, q, askCumulative);
      });

    let bidCumulative = 0;
    const bids = Array.from(book.topN(10).bids)
      .map(l => {
         const p = l.price;
         const q = l.qty;
         bidCumulative += parseFloat(p) * parseFloat(q);
         return formatBookRow(p, q, bidCumulative);
      });

    tui.updateOrderBook(
      asks,
      bids,
      ticker?.price || '—',
      rawPair,
      snap
        ? {
            ...snap.bookMetrics,
            microstructure: snap.microstructure,
          }
        : undefined,
    );
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
    } catch (err: any) {
      ctx.logger.warn({ mod: 'tui', err: err?.message }, 'USDT/INR ticker fetch failed');
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
      tui.log(`{red-fg}⚠ Balance fetch failed: ${err.message}{/red-fg}`, 'error');
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
      const activeCount = posArr.filter((p: any) => Number(p.active_pos ?? p.activePos ?? 0) !== 0).length;
      log(`✓ Loaded ${activeCount} active positions (${state.positions.size} total)`);
    } catch (err: any) {
      tui.log(`{red-fg}⚠ Position fetch failed: ${err.message}{/red-fg}`, 'error');
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
    tui.log('{red-fg}⚠ API Key/Secret missing — PUBLIC ONLY mode{/red-fg}', 'error');
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
    tui.log(`{red-fg}✗ Disconnected: ${reason}{/red-fg}`, 'error');
    tui.updateStatus({ connected: false });
  });
  ws.on('error', (error) => {
    tui.log(`{red-fg}✗ WS error: ${error.message}{/red-fg}`, 'error');
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
    void tradePersistence.persist({
      id: String(data.id ?? `${pair}:${data.T ?? Date.now()}:${data.p ?? '0'}:${data.q ?? '0'}`),
      ts: new Date(Number(data.T ?? Date.now())).toISOString(),
      pair,
      side: data.m ? 'MAKER' : 'TAKER',
      price: String(data.p ?? '0'),
      qty: String(data.q ?? '0'),
      source: 'ws.new-trade',
      payload: data,
    });
    if (state.allTrades.length > MAX_TRADES) {
      state.allTrades = state.allTrades.slice(0, MAX_TRADES);
    }

    // Refresh trade table only if this trade matches focused pair
    if (clean === getFocusedCleanPair()) {
      refreshBookDisplay();
    }
    state.lastPriceUpdate = Date.now();
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
    state.lastPriceUpdate = Date.now();
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
      const markPrice = resolveMarkPrice({ markPrice: info.mp, lastPrice: info.ls });
      const lastPrice = resolveMarkPrice({ markPrice: info.ls, lastPrice: info.mp });
      const changePct = info.pc;
      const openInterest = resolveOpenInterest(info);
      const syntheticFunding = estimateSyntheticFundingRate({
        futuresMarkPrice: markPrice,
        spotLastPrice: lastPrice,
      });

      const existing = state.tickers.get(pair) || { price: '0', markPrice: '0', change: '0' };
      state.tickers.set(pair, {
        price: lastPrice?.toString() || existing.price,
        markPrice: markPrice?.toString() || existing.markPrice,
        change: changePct?.toString() || existing.change,
        ...(openInterest !== undefined ? { openInterest: openInterest.toString() } : {}),
        ...(syntheticFunding
          ? {
            syntheticFundingRate: syntheticFunding.estimatedFundingRate.toString(),
            basis: syntheticFunding.basisRatio.toString(),
          }
          : {}),
      });

      if (pair === 'USDTINR' && lastPrice !== undefined) {
        state.usdtInrRate = parseFloat(lastPrice.toString());
      }

      // Update active positions PnL in real-time
      if (markPrice !== undefined) {
        state.positions.forEach((pos: any) => {
          if (cleanPair(pos.pair) === pair && pos.active_pos !== 0) {
            const mp = Number(markPrice);
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
    state.lastPriceUpdate = Date.now();
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
      const key = cleanPair(p.pair ?? '');
      const activePos = Number(p.active_pos ?? 0);
      if (key && activePos !== 0 && !trackOpenedAtByPair.has(key)) {
        trackOpenedAtByPair.set(key, new Date().toISOString());
      }
      if (key && activePos === 0) {
        trackOpenedAtByPair.delete(key);
      }
      const context: NegativeCloseContext = {
        side: activePos >= 0 ? 'LONG' : 'SHORT',
        unrealizedPnl: Number(p.unrealized_pnl ?? 0),
        maxConfluenceScore: Number(p.confluence_score ?? 0),
        breakevenArmed:
          p.breakeven_armed === true ||
          (typeof p.stop_loss === 'string' && Number(p.stop_loss) !== 0),
        openedAt: trackOpenedAtByPair.get(key),
        nowMs: Date.now(),
        timeStopMs: ctx.config.NEGATIVE_CLOSE_TIME_STOP_MS,
        highConfluenceThreshold: ctx.config.NEGATIVE_CLOSE_HC_MIN_SCORE,
      };
      const closeDecision = shouldAllowNegativeClose(context);
      if (!closeDecision.allow && closeDecision.reason !== 'positive_pnl_or_flat') {
        ctx.logger.debug(
          {
            mod: 'risk.negative-close',
            pair: p.pair,
            reason: closeDecision.reason,
          },
          'negative close policy blocked close',
        );
      }
      if (closeDecision.allow && closeDecision.reason === 'time_stop_kill') {
        ctx.runtime.positionStateMachine.transition(cleanPair(p.pair ?? ''), {
          type: 'time_stop_kill',
          reason: 'negative close allowed by time-stop-kill policy',
        });
        const riskEventSignal = {
          id: `risk:time-stop-kill:${p.id ?? p.pair ?? Date.now()}`,
          ts: new Date().toISOString(),
          strategy: 'risk.policy',
          type: 'risk.time_stop_kill',
          pair: p.pair,
          severity: 'warn' as const,
          payload: {
            positionId: p.id,
            pair: p.pair,
            unrealizedPnl: Number(p.unrealized_pnl ?? 0),
            openedAt: trackOpenedAtByPair.get(key),
            evaluatedAt: new Date().toISOString(),
          },
        };
        void ctx.bus.emit(riskEventSignal);
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
      const snap = account.snapshot();
      log(`✓ Account reconciler started (positions=${snap.positions.length}, balances=${snap.balances.length}, orders=${snap.orders.filter(o => o.status === 'open' || o.status === 'partially_filled').length})`);
      refreshPositionsDisplay();
      refreshOrdersDisplay();
      refreshBalanceDisplay();
    } catch (err: any) {
      tui.log(`{red-fg}⚠ Account reconciler seed failed: ${err.message}{/red-fg}`, 'error');
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
      tui.log(`{red-fg}Refresh error: ${err.message}{/red-fg}`, 'error');
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
