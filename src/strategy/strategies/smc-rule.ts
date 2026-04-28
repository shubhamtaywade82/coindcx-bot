import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

const MANIFEST: StrategyManifest = {
  id: 'smc.rule.v1', version: '1.0.0', mode: 'interval', intervalMs: 15000,
  pairs: ['*'], warmupCandles: 50,
  description: 'Deterministic SMC rule: aligned HTF/LTF + BOS + displacement + matching FVG',
};

export class SmcRule implements Strategy {
  manifest = MANIFEST;

  clone(): Strategy { return new SmcRule(); }

  evaluate(ctx: StrategyContext): StrategySignal {
    const { htf, ltf, confluence } = ctx.marketState;
    if (!confluence.aligned) {
      return { side: 'WAIT', confidence: 0, reason: 'HTF/LTF not aligned',
        noTradeCondition: 'confluence missing' };
    }
    if (!ltf.displacement.present) {
      return { side: 'WAIT', confidence: 0, reason: 'no displacement',
        noTradeCondition: 'no displacement' };
    }
    if (!ltf.bos) {
      return { side: 'WAIT', confidence: 0, reason: 'no BOS',
        noTradeCondition: 'no break of structure' };
    }
    const isUp = htf.trend === 'uptrend';
    const isDown = htf.trend === 'downtrend';
    if (!isUp && !isDown) {
      return { side: 'WAIT', confidence: 0, reason: 'HTF range', noTradeCondition: 'no HTF trend' };
    }
    const wantFvg = isUp ? 'bullish' : 'bearish';
    const fvg = ltf.fvg.find(f => f.type === wantFvg && !f.filled);
    if (!fvg) {
      return { side: 'WAIT', confidence: 0.2, reason: `no ${wantFvg} FVG`,
        noTradeCondition: 'awaiting FVG entry' };
    }
    const entry = ((fvg.gap[0] + fvg.gap[1]) / 2).toString();
    const sl = (isUp ? ltf.swing_low : ltf.swing_high).toString();
    const range = Math.abs(ltf.swing_high - ltf.swing_low);
    const tp = (isUp ? ltf.swing_high + range : ltf.swing_low - range).toString();
    const strength = ltf.displacement.strength === 'strong' ? 0.85 : 0.65;
    return {
      side: isUp ? 'LONG' : 'SHORT',
      confidence: strength,
      entry, stopLoss: sl, takeProfit: tp,
      reason: `aligned ${htf.trend} + BOS + ${ltf.displacement.strength} displacement + ${wantFvg} FVG`,
      ttlMs: 5 * 60_000,
      meta: { fvg, premium_discount: ltf.premium_discount },
    };
  }
}
