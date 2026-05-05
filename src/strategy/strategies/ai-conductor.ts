import type { Strategy, StrategyContext, StrategyManifest, StrategySignal, Side } from '../types';
import type { RecentSignalsStore, RecentStrategyEntry } from '../recent-signals-store';
import { alignStopTakeToSide } from './llm-pulse';

interface AnalyzerLike {
  analyze: (state: unknown) => Promise<any>;
}

const MANIFEST: StrategyManifest = {
  id: 'ai.conductor.v1',
  version: '1.0.0',
  mode: 'interval',
  intervalMs: 30_000,
  evaluationTimeoutMs: 90_000,
  pairs: ['*'],
  warmupCandles: 50,
  description: 'AI conductor: fuses verdicts from all strategies and emits the most convincing trade plan.',
};

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normSide(s: unknown): Side {
  const u = String(s ?? '').toUpperCase();
  if (u === 'LONG' || u === 'SHORT' || u === 'WAIT') return u;
  return 'WAIT';
}

function rewardRiskRatio(side: Side, entry: number, sl: number, tp: number): number | undefined {
  if (![entry, sl, tp].every(n => Number.isFinite(n)) || entry === sl) return undefined;
  const risk = side === 'LONG' ? entry - sl : sl - entry;
  const reward = side === 'LONG' ? tp - entry : entry - tp;
  if (risk <= 0 || reward <= 0) return undefined;
  return reward / risk;
}

function summariseStrategySignals(rows: RecentStrategyEntry[]): {
  summary: string;
  agreeingLong: number;
  agreeingShort: number;
  topConfidence: number;
} {
  if (rows.length === 0) {
    return { summary: 'No recent strategy signals available.', agreeingLong: 0, agreeingShort: 0, topConfidence: 0 };
  }
  let agreeingLong = 0;
  let agreeingShort = 0;
  let topConfidence = 0;
  const lines = rows.map(r => {
    if (r.side === 'LONG') agreeingLong += 1;
    if (r.side === 'SHORT') agreeingShort += 1;
    if (r.confidence > topConfidence) topConfidence = r.confidence;
    const lvls = [r.entry ? `entry=${r.entry}` : '', r.stopLoss ? `sl=${r.stopLoss}` : '', r.takeProfit ? `tp=${r.takeProfit}` : '', typeof r.rr === 'number' ? `rr=${r.rr.toFixed(2)}` : '']
      .filter(Boolean)
      .join(' ');
    const ageS = ((Date.now() - r.ts) / 1000).toFixed(0);
    return `- ${r.strategyId} [${r.side} c=${(r.confidence * 100).toFixed(0)}% age=${ageS}s] ${lvls} :: ${r.reason}`;
  });
  return { summary: lines.join('\n'), agreeingLong, agreeingShort, topConfidence };
}

export class AiConductor implements Strategy {
  manifest = MANIFEST;

  constructor(
    private analyzer: AnalyzerLike,
    private store: RecentSignalsStore,
    private readonly minConfidence: number = 0.6,
  ) {}

  clone(): Strategy {
    return new AiConductor(this.analyzer, this.store, this.minConfidence);
  }

  async evaluate(ctx: StrategyContext): Promise<StrategySignal> {
    const rows = this.store.list(ctx.pair).filter(r => r.strategyId !== this.manifest.id);
    const { summary, agreeingLong, agreeingShort, topConfidence } = summariseStrategySignals(rows);

    const stateInput = {
      ...ctx.marketState,
      account: {
        totals: ctx.account.totals,
        balances: ctx.account.balances.filter(b => parseFloat(b.available) > 0 || parseFloat(b.locked) > 0),
      },
      strategy_signals: rows,
      strategy_signals_summary: summary,
      strategy_consensus: { long: agreeingLong, short: agreeingShort, top_confidence: topConfidence },
      conductor_directive:
        'Choose ONLY the most convincing setup from strategy_signals when at least two agree or one shows confidence ≥ 0.75 with HTF/LTF alignment. Otherwise return WAIT. Quote the strategy id you trusted in `verdict`.',
    };

    const resp = await this.analyzer.analyze(stateInput);
    const side = normSide(resp?.signal);

    const entryNum = resp?.setup?.entry ? parseFloat(String(resp.setup.entry)) : undefined;
    let sl = resp?.setup?.sl ? parseFloat(String(resp.setup.sl)) : undefined;
    let tp = resp?.setup?.tp ? parseFloat(String(resp.setup.tp)) : undefined;
    let levelGeometryCorrected = false;
    if ((side === 'LONG' || side === 'SHORT') && entryNum !== undefined && sl !== undefined && tp !== undefined) {
      const aligned = alignStopTakeToSide(side, entryNum, sl, tp);
      sl = aligned.sl;
      tp = aligned.tp;
      levelGeometryCorrected = aligned.swapped;
    }
    let rr = resp?.setup?.rr;
    const recomputed =
      entryNum !== undefined && sl !== undefined && tp !== undefined
        ? rewardRiskRatio(side, entryNum, sl, tp)
        : undefined;
    if (recomputed !== undefined) rr = recomputed;

    const confidence = clamp(Number(resp?.confidence ?? 0));
    const passesGate = (side === 'LONG' || side === 'SHORT') && confidence >= this.minConfidence;
    const finalSide: Side = passesGate ? side : 'WAIT';
    const reasonPrefix = passesGate ? '' : `[gated c=${(confidence * 100).toFixed(0)}%<min=${(this.minConfidence * 100).toFixed(0)}%] `;

    return {
      side: finalSide,
      confidence,
      entry: entryNum ? String(entryNum) : undefined,
      stopLoss: sl ? String(sl) : undefined,
      takeProfit: tp ? String(tp) : undefined,
      reason: `${reasonPrefix}${String(resp?.verdict ?? '')}`,
      management: resp?.management_advice ? String(resp.management_advice) : undefined,
      noTradeCondition: resp?.no_trade_condition ? String(resp.no_trade_condition) : undefined,
      ttlMs: 5 * 60_000,
      meta: {
        rr,
        alternate: resp?.alternate_scenario,
        levels: resp?.levels,
        management: resp?.management_advice,
        currentBias: resp?.current_bias,
        expectedNextBias: resp?.expected_next_bias,
        biasTrigger: resp?.bias_trigger,
        chosen_strategy: resp?.chosen_strategy ?? null,
        consensus: { long: agreeingLong, short: agreeingShort, top_confidence: topConfidence },
        gated: !passesGate,
        ...(levelGeometryCorrected ? { levelGeometryCorrected: true } : {}),
      },
    };
  }
}
