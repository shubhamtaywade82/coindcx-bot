import type { Strategy, StrategyContext, StrategyManifest, StrategySignal, Side } from '../types';

interface AnalyzerLike {
  analyze: (state: unknown) => Promise<any>;
}

const MANIFEST: StrategyManifest = {
  id: 'llm.pulse.v1', version: '1.0.0', mode: 'bar_close', barTimeframes: ['15m'],
  evaluationTimeoutMs: 90000,
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
    const stateInput = { 
      ...ctx.marketState,
      account: {
        totals: ctx.account.totals,
        balances: ctx.account.balances.filter(b => parseFloat(b.available) > 0 || parseFloat(b.locked) > 0)
      }
    };
    const resp = await this.analyzer.analyze(stateInput);
    const side = normSide(resp?.signal);

    const entry = resp?.setup?.entry ? parseFloat(String(resp.setup.entry)) : undefined;
    const sl = resp?.setup?.sl ? parseFloat(String(resp.setup.sl)) : undefined;
    const tp = resp?.setup?.tp ? parseFloat(String(resp.setup.tp)) : undefined;

    let rr = resp?.setup?.rr;
    if (entry && sl && tp && entry !== sl) {
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp - entry);
      rr = reward / risk;
    }

    return {
      side,
      confidence: clamp(Number(resp?.confidence ?? 0)),
      entry: entry ? String(entry) : undefined,
      stopLoss: sl ? String(sl) : undefined,
      takeProfit: tp ? String(tp) : undefined,
      reason: String(resp?.verdict ?? ''),
      management: resp?.management_advice ? String(resp.management_advice) : undefined,
      noTradeCondition: resp?.no_trade_condition ? String(resp.no_trade_condition) : undefined,
      ttlMs: 5 * 60_000,
      meta: { 
        rr, 
        alternate: resp?.alternate_scenario, 
        levels: resp?.levels,
        management: resp?.management_advice
      },
    };
  }
}
