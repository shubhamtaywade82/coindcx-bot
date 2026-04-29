import type { Strategy, StrategyContext, StrategyManifest, StrategySignal, Side } from '../types';

interface AnalyzerLike {
  analyze: (state: unknown) => Promise<any>;
}

const MANIFEST: StrategyManifest = {
  id: 'llm.pulse.v1', version: '1.0.0', mode: 'bar_close', barTimeframes: ['15m'],
  pairs: ['*'], warmupCandles: 50,
  description: 'LLM-driven SMC pulse via Ollama on 15m candle close',
};

function clamp(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normSide(s: unknown): Side {
  const u = String(s ?? '').toUpperCase();
  if (u === 'LONG' || u === 'SHORT' || u === 'WAIT') return u;
  return 'WAIT';
}

export class LlmPulse implements Strategy {
  manifest = MANIFEST;

  constructor(private analyzer: AnalyzerLike) {}

  clone(): Strategy { return new LlmPulse(this.analyzer); }

  async evaluate(ctx: StrategyContext): Promise<StrategySignal> {
    const stateInput = { symbol: ctx.pair, ...ctx.marketState };
    const resp = await this.analyzer.analyze(stateInput);
    const side = normSide(resp?.signal);
    return {
      side,
      confidence: clamp(Number(resp?.confidence ?? 0)),
      entry: resp?.setup?.entry ? String(resp.setup.entry) : undefined,
      stopLoss: resp?.setup?.sl ? String(resp.setup.sl) : undefined,
      takeProfit: resp?.setup?.tp ? String(resp.setup.tp) : undefined,
      reason: String(resp?.verdict ?? ''),
      noTradeCondition: resp?.no_trade_condition ? String(resp.no_trade_condition) : undefined,
      ttlMs: 5 * 60_000,
      meta: { rr: resp?.setup?.rr, alternate: resp?.alternate_scenario },
    };
  }
}
