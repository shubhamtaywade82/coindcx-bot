import type { MarketState, Candle } from '../../ai/state-builder';
import type { Strategy, StrategyContext } from '../types';
import type { AccountSnapshot } from '../../account/types';
import type { DataSource } from './types';
import { Simulator } from './simulator';
import { computeMetrics, type BacktestMetrics } from './metrics';
import { exportLedgerCsv } from './trade-ledger';
import { SignalEngine } from '../../runtime/signal-engine';
import { OrderBook } from '../../marketdata/book/orderbook';

const EMPTY_ACCOUNT: AccountSnapshot = {
  positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' },
};

export interface BacktestSummary {
  metrics: BacktestMetrics;
  coverage: number;
  events: number;
}

export interface RunBacktestArgs {
  strategy: Strategy;
  pair: string;
  dataSource: DataSource;
  buildMarketState: (htf: Candle[], ltf: Candle[], pair: string) => Promise<MarketState | null> | MarketState | null;
  pessimistic: boolean;
  outCsv: string;
  warmupCandles?: Candle[];
}

export async function runBacktest(args: RunBacktestArgs): Promise<BacktestSummary> {
  if (args.strategy.warmup && args.warmupCandles) {
    await args.strategy.warmup({ pair: args.pair, candles: args.warmupCandles });
  }
  const signalEngine = new SignalEngine();
  const sim = new Simulator({ pair: args.pair, pessimistic: args.pessimistic });
  const replayOrderBook = new OrderBook(args.pair);
  let events = 0;
  for await (const e of args.dataSource.iterate()) {
    events++;
    sim.advanceClock(e.ts);
    if (e.kind === 'gap') continue;
    if (e.kind === 'tick' && e.asks !== undefined && e.bids !== undefined) {
      if (replayOrderBook.state() === 'init') {
        replayOrderBook.applySnapshot(e.asks, e.bids, e.ts, e.seq);
      } else {
        replayOrderBook.applyDelta(e.asks, e.bids, e.ts, e.seq, e.prevSeq);
      }
      const replayMid = replayOrderBook.midPrice();
      if (Number.isFinite(replayMid)) {
        e.price = replayMid as number;
      }
    }
    const market = await args.buildMarketState([], [], args.pair);
    if (!market) continue;
    const ctx: StrategyContext = {
      ts: e.ts, pair: args.pair, marketState: market,
      account: EMPTY_ACCOUNT, recentFills: [],
      trigger: e.kind === 'bar_close'
        ? { kind: 'bar_close', tf: e.tf ?? '1m' }
        : { kind: 'tick', channel: 'new-trade', raw: e.raw },
    };
    const raw = await Promise.resolve(args.strategy.evaluate(ctx));
    if (raw && raw.side !== 'WAIT') {
      const runtimeSignal = {
        id: `bt:${args.strategy.manifest.id}:${args.pair}:${e.ts}`,
        ts: new Date(e.ts).toISOString(),
        strategy: args.strategy.manifest.id,
        type: raw.side === 'LONG' ? 'strategy.long' : 'strategy.short',
        pair: args.pair,
        severity: 'info' as const,
        payload: {
          confidence: raw.confidence,
          entry: raw.entry,
          stopLoss: raw.stopLoss,
          takeProfit: raw.takeProfit,
          reason: raw.reason,
          ttlMs: raw.ttlMs,
          noTradeCondition: raw.noTradeCondition,
          management: raw.management,
          meta: raw.meta,
        },
      };
      const intent = signalEngine.buildTradeIntent({ signal: runtimeSignal });
      if (intent) sim.applyTradeIntent(intent);
    }
    if (e.kind === 'bar_close' && e.high !== undefined && e.low !== undefined) {
      sim.markToMarketBar(e.ts, { high: e.high, low: e.low });
    } else if (e.price !== undefined) {
      sim.markToMarket(e.ts, e.price);
    }
  }
  const metrics = computeMetrics(sim.tradeLedger());
  exportLedgerCsv(args.outCsv, sim.tradeLedger());
  return { metrics, coverage: args.dataSource.coverage(), events };
}
