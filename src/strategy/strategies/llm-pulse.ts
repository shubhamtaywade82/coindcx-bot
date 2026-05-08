import type { Strategy, StrategyContext, StrategyManifest, StrategySignal, Side } from '../types';

interface AnalyzerLike {
  analyze: (state: unknown) => Promise<any>;
}

const MANIFEST: StrategyManifest = {
  id: 'llm.pulse.v1', version: '1.0.0', mode: 'bar_close', barTimeframes: ['15m'],
  evaluationTimeoutMs: 180000,
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

/** LONG: SL below entry, TP above. SHORT: TP below entry, SL above. LLMs often emit LONG geometry with a SHORT label — swap when that pattern is exact. */
export function alignStopTakeToSide(side: Side, entry: number, sl: number, tp: number): { sl: number; tp: number; swapped: boolean } {
  if (side !== 'LONG' && side !== 'SHORT') return { sl, tp, swapped: false };
  if (![entry, sl, tp].every(n => Number.isFinite(n))) return { sl, tp, swapped: false };

  const longGeometry = sl < entry && entry < tp;
  const shortGeometry = tp < entry && entry < sl;

  if (side === 'LONG') {
    if (longGeometry) return { sl, tp, swapped: false };
    if (shortGeometry) return { sl: tp, tp: sl, swapped: true };
    return { sl, tp, swapped: false };
  }

  if (shortGeometry) return { sl, tp, swapped: false };
  if (longGeometry) return { sl: tp, tp: sl, swapped: true };
  return { sl, tp, swapped: false };
}

function rewardRiskRatio(side: Side, entry: number, sl: number, tp: number): number | undefined {
  if (![entry, sl, tp].every(n => Number.isFinite(n)) || entry === sl) return undefined;
  const risk = side === 'LONG' ? entry - sl : sl - entry;
  const reward = side === 'LONG' ? tp - entry : entry - tp;
  if (risk <= 0 || reward <= 0) return undefined;
  return reward / risk;
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
    let side = normSide(resp?.signal);
    let confidence = clamp(Number(resp?.confidence ?? 0));

    const adaptive = ctx.marketState.prediction_feedback?.adaptive_min_confidence_llm;
    const floor =
      typeof adaptive === 'number' && Number.isFinite(adaptive)
        ? adaptive
        : undefined;
    if (floor !== undefined && (side === 'LONG' || side === 'SHORT') && confidence < floor) {
      side = 'WAIT';
      confidence = Math.max(confidence, 0);
    }

    const entry = resp?.setup?.entry ? parseFloat(String(resp.setup.entry)) : undefined;
    let sl = resp?.setup?.sl ? parseFloat(String(resp.setup.sl)) : undefined;
    let tp = resp?.setup?.tp ? parseFloat(String(resp.setup.tp)) : undefined;

    let levelGeometryCorrected = false;
    if (side === 'LONG' || side === 'SHORT') {
      if (entry !== undefined && sl !== undefined && tp !== undefined) {
        const aligned = alignStopTakeToSide(side, entry, sl, tp);
        sl = aligned.sl;
        tp = aligned.tp;
        levelGeometryCorrected = aligned.swapped;
      }
    }

    let rr = resp?.setup?.rr;
    const recomputed =
      side === 'LONG' || side === 'SHORT'
        ? entry !== undefined && sl !== undefined && tp !== undefined
          ? rewardRiskRatio(side, entry, sl, tp)
          : undefined
        : undefined;
    if (recomputed !== undefined) rr = recomputed;

    const tradable = side === 'LONG' || side === 'SHORT';

    return {
      side,
      confidence,
      entry: tradable && entry !== undefined ? String(entry) : undefined,
      stopLoss: tradable && sl !== undefined ? String(sl) : undefined,
      takeProfit: tradable && tp !== undefined ? String(tp) : undefined,
      reason: String(resp?.verdict ?? ''),
      management: resp?.management_advice ? String(resp.management_advice) : undefined,
      noTradeCondition: resp?.no_trade_condition ? String(resp.no_trade_condition) : undefined,
      ttlMs: 5 * 60_000,
      meta: {
        rr: tradable ? rr : undefined,
        alternate: resp?.alternate_scenario,
        levels: resp?.levels,
        management: resp?.management_advice,
        currentBias: resp?.current_bias,
        expectedNextBias: resp?.expected_next_bias,
        biasTrigger: resp?.bias_trigger,
        ...(levelGeometryCorrected ? { levelGeometryCorrected: true } : {}),
      },
    };
  }
}
