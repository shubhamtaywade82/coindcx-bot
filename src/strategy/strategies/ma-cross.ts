import type { Candle } from '../../ai/state-builder';
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

const MANIFEST: StrategyManifest = {
  id: 'ma.cross.v1', version: '1.0.0', mode: 'bar_close',
  barTimeframes: ['1m'], pairs: ['*'], warmupCandles: 50,
  description: 'Fast/slow SMA crossover (10/30) on 1m bar close',
};

const FAST = 10;
const SLOW = 30;

function sma(values: number[], n: number): number {
  if (values.length < n) return NaN;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

export class MaCross implements Strategy {
  manifest = MANIFEST;
  private closes: number[] = [];
  private prevFast = NaN;
  private prevSlow = NaN;

  clone(): Strategy { return new MaCross(); }

  warmup(ctx: { pair: string; candles: Candle[] }): void {
    this.closes = ctx.candles.map(c => c.close);
    this.prevFast = sma(this.closes, FAST);
    this.prevSlow = sma(this.closes, SLOW);
  }

  evaluate(ctx: StrategyContext): StrategySignal {
    const lastClose = ctx.marketState.htf.swing_high;
    this.closes.push(lastClose);
    if (this.closes.length > 200) this.closes = this.closes.slice(-200);
    const fast = sma(this.closes, FAST);
    const slow = sma(this.closes, SLOW);
    const prevFast = this.prevFast;
    const prevSlow = this.prevSlow;
    this.prevFast = fast;
    this.prevSlow = slow;
    if (Number.isNaN(prevFast) || Number.isNaN(prevSlow) || Number.isNaN(fast) || Number.isNaN(slow)) {
      return { side: 'WAIT', confidence: 0, reason: 'warmup', noTradeCondition: 'insufficient data' };
    }
    if (prevFast <= prevSlow && fast > slow) {
      return { side: 'LONG', confidence: 0.6, reason: 'golden cross', entry: lastClose.toString(), ttlMs: 60_000 };
    }
    if (prevFast >= prevSlow && fast < slow) {
      return { side: 'SHORT', confidence: 0.6, reason: 'death cross', entry: lastClose.toString(), ttlMs: 60_000 };
    }
    return { side: 'WAIT', confidence: 0, reason: 'no cross', noTradeCondition: 'awaiting cross' };
  }
}
