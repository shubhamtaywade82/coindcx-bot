import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

function liquidityRaidMicro(ctx: StrategyContext): number | undefined {
  const lc = ctx.fusion?.liquidityRaid?.lastConfirmed;
  if (!lc || lc.outcome !== 'reversalCandidate') return undefined;
  if (!(lc.actionable || lc.watchlistQuality)) return undefined;
  if (lc.side === 'buySide') return 0.35;
  if (lc.side === 'sellSide') return -0.35;
  return undefined;
}

/**
 * Three entry models from the bearish SMC rulebook (ordered by confluence strength):
 *
 *  1. break_block_reversal — CHOCH: HTF still uptrend but LTF prints a bearish BOS.
 *     Requires a prior liquidity sweep + displacement. Highest-conviction reversal entry.
 *
 *  2. ob_retest — HTF already downtrend, LTF confirms with bearish BOS + displacement.
 *     Standard continuation entry into the order block / imbalance.
 *
 *  3. supply_retest — HTF downtrend, price reaches the premium zone (supply area).
 *     Lower precision; needs sweep or book confirmation to cross the confidence gate.
 */
type EntryModel = 'break_block_reversal' | 'ob_retest' | 'supply_retest';

const MANIFEST: StrategyManifest = {
  id: 'bearish.smc.v1',
  version: '1.0.0',
  mode: 'interval',
  intervalMs: 15_000,
  pairs: ['*'],
  warmupCandles: 50,
  description: 'Bearish SMC: CHOCH/BOS + liquidity sweep + OB/supply retest (3-model sequence)',
};

/** Minimum R:R before the signal is allowed through. */
const MIN_RR = 1.5;

/** Per-model minimum confidence gate. */
const MIN_CONFIDENCE: Record<EntryModel, number> = {
  break_block_reversal: 0.60, // CHOCH is risky — needs sweep + displacement
  ob_retest:           0.55,
  supply_retest:       0.50, // Needs sweep or book to reach this
};

export class BearishSmc implements Strategy {
  manifest = MANIFEST;

  clone(): Strategy { return new BearishSmc(); }

  evaluate(ctx: StrategyContext): StrategySignal {
    const { htf, ltf, state, book } = ctx.marketState;
    const price = ctx.marketState.current_price;

    // ── Sanity: need valid swing levels (state-builder returns 0 on empty candles) ──
    if (ltf.swing_high <= 0 || ltf.swing_low <= 0 || ltf.swing_high <= ltf.swing_low) {
      return wait('swing levels not yet established');
    }

    // ── Step 1: HTF context must be bearish ───────────────────────────────────
    //
    // CHOCH scenario: HTF still prints higher-highs (uptrend) but LTF has just
    // broken structure to the downside — first sign of a reversal.
    //
    // Continuation: HTF already in downtrend, looking for LTF alignment.
    const isChoch        = htf.trend === 'uptrend'   && ltf.trend === 'downtrend';
    const isContinuation = htf.trend === 'downtrend';

    if (!isChoch && !isContinuation) {
      return wait(`no bearish HTF context — HTF is ${htf.trend}`);
    }

    // ── Step 2: Identify the entry model ─────────────────────────────────────
    //
    // Precedence: break_block_reversal > ob_retest > supply_retest.
    // Each model is checked only when the prior, more specific model does not apply.
    let model: EntryModel;

    if (isChoch && state.is_post_sweep && ltf.displacement.present) {
      // HTF up, LTF bearish BOS (CHOCH) + liquidity swept above highs + strong move away
      model = 'break_block_reversal';
    } else if (isContinuation && ltf.trend === 'downtrend' && ltf.displacement.present) {
      // HTF down, LTF close-based bearish BOS + displacement = OB rejection active
      model = 'ob_retest';
    } else if (isContinuation && ltf.premium_discount === 'premium') {
      // HTF down, price in the premium / supply half of the range — await rejection
      model = 'supply_retest';
    } else {
      return wait('no valid model — awaiting BOS / displacement / premium retest');
    }

    // ── Step 3: False BOS filter ──────────────────────────────────────────────
    //
    // ltf.trend === 'downtrend' already guarantees a CLOSE below swing_low (analyzeStructure
    // uses last.close, not a wick), so there is no extra wick-rejection step needed for
    // models 1 and 2. supply_retest intentionally does not require a BOS yet.

    // ── Step 4: Compute levels ────────────────────────────────────────────────
    //
    // Entry: bearish FVG midpoint if one exists (price retracing into the imbalance),
    //        otherwise the current price (market entry).
    const bearishFvg = ltf.fvg.find(f => f.type === 'bearish' && !f.filled);
    const entry = bearishFvg
      ? (bearishFvg.gap[0] + bearishFvg.gap[1]) / 2
      : price;

    // SL: 0.1% above the LTF swing high — the zone that would invalidate the setup.
    const sl = ltf.swing_high * 1.001;
    // TP: 0.1% below the LTF swing low — first demand / liquidity target.
    const tp = ltf.swing_low * 0.999;

    // Geometry guard: for a SHORT, entry must sit between TP and SL.
    if (entry >= sl || entry <= tp) {
      return wait('invalid geometry — entry outside TP/SL range (zone overlapping price)');
    }

    const risk   = sl - entry; // positive for a SHORT
    const reward = entry - tp; // positive for a SHORT

    if (risk <= 0 || reward <= 0) {
      return wait('degenerate risk/reward — swing levels too close to entry');
    }

    const rr = reward / risk;
    if (rr < MIN_RR) {
      return wait(`R:R ${rr.toFixed(2)} below minimum ${MIN_RR} — zone too close to target`);
    }

    // ── Step 5: Score confluence ──────────────────────────────────────────────
    let confidence =
      model === 'break_block_reversal' ? 0.45 :
      model === 'ob_retest'            ? 0.40 :
      /* supply_retest */                0.30;

    // Each bonus is additive; scores are capped at 1.0 after summing.
    if (state.is_post_sweep)                      confidence += 0.20; // liquidity swept above highs
    if (ltf.displacement.strength === 'strong')   confidence += 0.15; // aggressive departure from zone
    else if (ltf.displacement.present)            confidence += 0.08; // weaker but still present
    if (isContinuation)                           confidence += 0.08; // HTF already aligned
    if (bearishFvg)                               confidence += 0.08; // imbalance to fill on retest
    if (ltf.premium_discount === 'premium')       confidence += 0.05; // price confirmed in supply area
    if (book?.imbalance === 'ask-heavy')          confidence += 0.05; // live book confirms selling pressure
    if (rr >= 3.0)                                confidence += 0.04; // excellent risk:reward bonus

    confidence = Math.min(confidence, 1.0);

    if (confidence < MIN_CONFIDENCE[model]) {
      return wait(
        `confidence ${(confidence * 100).toFixed(0)}% below ${(MIN_CONFIDENCE[model] * 100).toFixed(0)}% ` +
        `minimum for ${model.replace(/_/g, ' ')}`,
      );
    }

    // ── Signal ────────────────────────────────────────────────────────────────
    const contextLabel = isChoch ? 'CHOCH' : 'HTF downtrend';
    const sweepLabel   = state.is_post_sweep    ? ' + sweep'                            : '';
    const dispLabel    = ltf.displacement.present
                          ? ` + ${ltf.displacement.strength} displacement`              : '';
    const fvgLabel     = bearishFvg             ? ' + bearish FVG'                      : '';

    return {
      side: 'SHORT',
      confidence,
      entry:      entry.toFixed(4),
      stopLoss:   sl.toFixed(4),
      takeProfit: tp.toFixed(4),
      reason: `Bearish SMC [${model.replace(/_/g, ' ')}]: ${contextLabel}${sweepLabel}${dispLabel}${fvgLabel} | RR ${rr.toFixed(2)}:1`,
      ttlMs: 10 * 60_000,
      meta: {
        model,
        rr:            parseFloat(rr.toFixed(2)),
        htfTrend:      htf.trend,
        ltfTrend:      ltf.trend,
        postSweep:     state.is_post_sweep,
        atPremium:     ltf.premium_discount === 'premium',
        hasBearishFvg: !!bearishFvg,
        bookImbalance: book?.imbalance ?? 'unavailable',
        liquidityRaidScore: ctx.fusion?.liquidityRaid?.lastConfirmed?.score,
        liquidityRaidContribution: liquidityRaidMicro(ctx),
      },
    };
  }
}

function wait(reason: string): StrategySignal {
  return { side: 'WAIT', confidence: 0, reason, noTradeCondition: reason };
}
