import type { MarketState, Candle } from '../../ai/state-builder';
import type { Strategy, StrategyContext, StrategySignal } from '../types';
import type { AccountSnapshot } from '../../account/types';
import type { DataSource } from './types';
import { Simulator } from './simulator';
import { computeMetrics, type BacktestMetrics } from './metrics';
import { exportLedgerCsv } from './trade-ledger';

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
  buildMarketState: (htf: Candle[], ltf: Candle[]) => MarketState | null;
  pessimistic: boolean;
  outCsv: string;
  warmupCandles?: Candle[];
}

export async function runBacktest(args: RunBacktestArgs): Promise<BacktestSummary> {
  if (args.strategy.warmup && args.warmupCandles) {
    await args.strategy.warmup({ pair: args.pair, candles: args.warmupCandles });
  }
  const sim = new Simulator({ pair: args.pair, pessimistic: args.pessimistic });
  let events = 0;
  for await (const e of args.dataSource.iterate()) {
    events++;
    sim.advanceClock(e.ts);
    if (e.kind === 'gap') continue;
    const market = args.buildMarketState([], []);
    if (!market) continue;
    const ctx: StrategyContext = {
      ts: e.ts, pair: args.pair, marketState: market,
      account: EMPTY_ACCOUNT, recentFills: [],
      trigger: e.kind === 'bar_close'
        ? { kind: 'bar_close', tf: e.tf ?? '1m' }
        : { kind: 'tick', channel: 'new-trade', raw: e.raw },
    };
    const raw = await Promise.resolve(args.strategy.evaluate(ctx));
    if (raw && raw.side !== 'WAIT') sim.applySignal(raw as StrategySignal);
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
