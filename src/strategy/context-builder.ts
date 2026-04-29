import type { Candle, MarketState } from '../ai/state-builder';
import type { AccountSnapshot, Fill } from '../account/types';
import type { StrategyContext, StrategyTrigger } from './types';

export interface CandleProvider {
  ltf: (pair: string) => Candle[];
  htf: (pair: string) => Candle[];
}

export interface ContextBuilderOptions {
  buildMarketState: (htf: Candle[], ltf: Candle[], pair: string) => Promise<MarketState | null> | MarketState | null;
  candleProvider: CandleProvider;
  accountSnapshot: () => AccountSnapshot;
  recentFills: (n?: number) => Fill[];
  clock?: () => number;
}

export class ContextBuilder {
  private clock: () => number;

  constructor(private opts: ContextBuilderOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  async build(args: { pair: string; trigger: StrategyTrigger }): Promise<StrategyContext | null> {
    const ltf = this.opts.candleProvider.ltf(args.pair);
    const htf = this.opts.candleProvider.htf(args.pair);
    const marketState = await this.opts.buildMarketState(htf, ltf, args.pair);
    if (!marketState) return null;
    return {
      ts: this.clock(),
      pair: args.pair,
      marketState,
      account: this.opts.accountSnapshot(),
      recentFills: this.opts.recentFills(20),
      trigger: args.trigger,
    };
  }
}
