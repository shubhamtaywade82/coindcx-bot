/**
 * Paper-only Supertrend + fixed-notional martingale adds (DB-backed simulation).
 *
 * Risk warning: Martingale on drawdown with no stop — paper only. Live trading would be
 * account-suicide on extended trends. Use for behavioral observation only.
 *
 * Pairs must be listed in `COINDCX_PAIRS` so the candle-close worker invokes `runOnce`
 * for each bar (the strategy does not subscribe outside the core pair list).
 */

import type { AppLogger } from '../../logging/logger';
import { computeSupertrend, type SupertrendCandle } from '../../marketdata/indicators/supertrend';
import {
  PaperSupertrendRepository,
  type PaperSupertrendLeg,
  type PaperSupertrendPosition,
  type PaperSupertrendSide,
} from '../../persistence/paper-supertrend-repository';
import type { Strategy, StrategyContext, StrategyManifest, StrategySignal } from '../types';

export interface PaperSupertrendStrategyDeps {
  repo: PaperSupertrendRepository;
  logger: AppLogger;
  PAPER_SUPERTREND_PAIRS: readonly string[];
  PAPER_SUPERTREND_CAPITAL_USDT: number;
  PAPER_SUPERTREND_LEG_PCT: number;
  PAPER_SUPERTREND_INITIAL_TP_PCT: number;
  PAPER_SUPERTREND_ADD_TP_PCT: number;
  PAPER_SUPERTREND_DD_TRIGGER_PCT: number;
  PAPER_SUPERTREND_MAX_LEGS: number;
  PAPER_SUPERTREND_ST_LENGTH: number;
  PAPER_SUPERTREND_ST_MULTIPLIER: number;
  PAPER_SUPERTREND_TF: string;
}

function tfToMs(tf: string): number {
  const m = /^(\d+)(m|h|d)$/.exec(tf.trim());
  if (!m) return 15 * 60_000;
  const n = Number(m[1]);
  const u = m[2];
  if (u === 'm') return n * 60_000;
  if (u === 'h') return n * 3_600_000;
  return n * 86_400_000;
}

function markPnlPct(side: PaperSupertrendSide, avgEntry: number, mark: number): number {
  if (!Number.isFinite(avgEntry) || avgEntry <= 0 || !Number.isFinite(mark)) return 0;
  if (side === 'LONG') return ((mark - avgEntry) / avgEntry) * 100;
  return ((avgEntry - mark) / avgEntry) * 100;
}

function tpPriceFor(side: PaperSupertrendSide, avgEntry: number, tpPct: number): number {
  const f = tpPct / 100;
  if (side === 'LONG') return avgEntry * (1 + f);
  return avgEntry * (1 - f);
}

function tpHit(side: PaperSupertrendSide, mark: number, tpPrice: number): boolean {
  if (side === 'LONG') return mark >= tpPrice;
  return mark <= tpPrice;
}

function weightedAvgEntry(legs: PaperSupertrendLeg[]): number {
  let num = 0;
  let den = 0;
  for (const l of legs) {
    num += l.price * l.notionalUsdt;
    den += l.notionalUsdt;
  }
  return den > 0 ? num / den : legs[0]?.price ?? 0;
}

function realizedPnlUsdt(side: PaperSupertrendSide, legs: PaperSupertrendLeg[], exit: number): number {
  let qty = 0;
  let cost = 0;
  for (const l of legs) {
    qty += l.qty;
    cost += l.qty * l.price;
  }
  if (side === 'LONG') return qty * exit - cost;
  return cost - qty * exit;
}

function toStCandles(ctx: StrategyContext, tf: string): SupertrendCandle[] | null {
  const raw = ctx.fusion?.candles?.[tf];
  if (!raw || raw.length < 5) return null;
  return raw.map((c) => ({ high: c.high, low: c.low, close: c.close }));
}

function baseLegNotional(capital: number, legPct: number): number {
  return (capital * legPct) / 100;
}

function allocatedNotional(legs: PaperSupertrendLeg[]): number {
  return legs.reduce((s, l) => s + l.notionalUsdt, 0);
}

function sideFromSt(direction: 'up' | 'down'): PaperSupertrendSide {
  return direction === 'up' ? 'LONG' : 'SHORT';
}

function stAgainstPosition(side: PaperSupertrendSide, direction: 'up' | 'down'): boolean {
  return (side === 'LONG' && direction === 'down') || (side === 'SHORT' && direction === 'up');
}

export class PaperSupertrendStrategy implements Strategy {
  readonly manifest: StrategyManifest;
  private readonly maxLegWarnOnce = new Set<string>();
  private readonly capitalLegWarnOnce = new Set<string>();

  constructor(private readonly deps: PaperSupertrendStrategyDeps) {
    this.manifest = {
      id: 'paper.supertrend.v1',
      version: '1.0.0',
      mode: 'bar_close',
      pairs: [...deps.PAPER_SUPERTREND_PAIRS],
      barTimeframes: [deps.PAPER_SUPERTREND_TF],
      warmupCandles: 60,
      description: 'Paper Supertrend martingale (15m ST flip entries, DCA at -10%, TP ladder)',
    };
  }

  clone(): Strategy {
    return new PaperSupertrendStrategy(this.deps);
  }

  async evaluate(ctx: StrategyContext): Promise<StrategySignal | null> {
    void ctx.account;
    void ctx.recentFills;
    void ctx.marketState;

    if (ctx.trigger.kind !== 'bar_close' || ctx.trigger.tf !== this.deps.PAPER_SUPERTREND_TF) {
      return null;
    }
    const pair = ctx.pair;
    if (!this.deps.PAPER_SUPERTREND_PAIRS.includes(pair)) return null;

    const candles = toStCandles(ctx, this.deps.PAPER_SUPERTREND_TF);
    if (!candles) return null;

    const st = computeSupertrend(
      candles,
      this.deps.PAPER_SUPERTREND_ST_LENGTH,
      this.deps.PAPER_SUPERTREND_ST_MULTIPLIER,
    );
    if (!st) return null;

    const lastClose = candles[candles.length - 1]!.close;
    const ltp = ctx.fusion?.ltp?.price;
    const markNum =
      typeof ltp === 'number' && Number.isFinite(ltp) && ltp > 0 ? ltp : lastClose;

    const pos = await this.deps.repo.findOpen(pair);
    if (!pos) {
      if (!st.flipped) return null;
      const side = sideFromSt(st.direction);
      return this.tryEntry(ctx, pair, side, candles, markNum);
    }

    if (!Number.isFinite(markNum) || markNum <= 0) return null;

    const pnlPct = markPnlPct(pos.side, pos.avgEntry, markNum);
    await this.deps.repo.updateMark(pair, { lastMarkPrice: markNum, lastMarkPnlPct: pnlPct }, ctx.ts);

    if (tpHit(pos.side, markNum, pos.tpPrice)) {
      return this.emitTakeProfit(ctx, pos, markNum);
    }

    const dd = -this.deps.PAPER_SUPERTREND_DD_TRIGGER_PCT;
    if (pnlPct <= dd && pos.legs.length < this.deps.PAPER_SUPERTREND_MAX_LEGS) {
      const add = await this.tryAddLeg(ctx, pos, markNum);
      if (add) return add;
    }

    if (pnlPct <= dd && pos.legs.length >= this.deps.PAPER_SUPERTREND_MAX_LEGS) {
      if (!this.maxLegWarnOnce.has(pair)) {
        this.maxLegWarnOnce.add(pair);
        return this.paperSignal({
          type: 'paper.supertrend.warn',
          severity: 'warn',
          side: pos.side,
          confidence: 0.5,
          reason: 'Max legs reached; frozen adds until TP or favorable ST flip',
          entry: String(pos.avgEntry),
          takeProfit: String(pos.tpPrice),
          meta: {
            pair,
            side: pos.side,
            entryPrice: pos.avgEntry,
            tpPrice: pos.tpPrice,
            tpPct: pos.tpPct,
            legCount: pos.legs.length,
            totalNotionalUsdt: pos.totalNotionalUsdt,
            markPnlPct: pnlPct,
            warnKind: 'max_legs',
          },
        });
      }
    }

    if (st.flipped && stAgainstPosition(pos.side, st.direction)) {
      return this.paperSignal({
        type: 'paper.supertrend.flip_ignored',
        severity: 'info',
        side: 'WAIT',
        confidence: 0,
        reason: 'Supertrend flipped against open paper position; hold (no negative exit)',
        entry: String(pos.avgEntry),
        takeProfit: String(pos.tpPrice),
        meta: {
          pair,
          side: pos.side,
          entryPrice: pos.avgEntry,
          tpPrice: pos.tpPrice,
          tpPct: pos.tpPct,
          legCount: pos.legs.length,
          totalNotionalUsdt: pos.totalNotionalUsdt,
          markPnlPct: pnlPct,
        },
      });
    }

    return null;
  }

  private paperSignal(input: {
    type: string;
    severity: 'info' | 'warn' | 'critical';
    side: PaperSupertrendSide | 'WAIT';
    confidence: number;
    reason: string;
    entry?: string;
    takeProfit?: string;
    meta: Record<string, unknown>;
  }): StrategySignal {
    return {
      side: input.side === 'SHORT' ? 'SHORT' : input.side === 'LONG' ? 'LONG' : 'WAIT',
      confidence: input.confidence,
      reason: input.reason,
      entry: input.entry,
      takeProfit: input.takeProfit,
      directEmit: { type: input.type, severity: input.severity },
      meta: input.meta,
    };
  }

  private async tryEntry(
    ctx: StrategyContext,
    pair: string,
    side: PaperSupertrendSide,
    candles: SupertrendCandle[],
    markNum: number,
  ): Promise<StrategySignal | null> {
    const last = candles[candles.length - 1]!;
    const price = last.close;
    const cap = this.deps.PAPER_SUPERTREND_CAPITAL_USDT;
    const legN = baseLegNotional(cap, this.deps.PAPER_SUPERTREND_LEG_PCT);
    if (legN > cap + 1e-6) {
      return this.paperSignal({
        type: 'paper.supertrend.warn',
        severity: 'warn',
        side: 'WAIT',
        confidence: 0,
        reason: 'Paper capital insufficient for configured leg size',
        meta: {
          pair,
          side,
          entryPrice: price,
          tpPrice: 0,
          tpPct: this.deps.PAPER_SUPERTREND_INITIAL_TP_PCT,
          legCount: 0,
          totalNotionalUsdt: 0,
          markPnlPct: 0,
          warnKind: 'capital',
        },
      });
    }
    const qty = legN / price;
    const tpPct = this.deps.PAPER_SUPERTREND_INITIAL_TP_PCT;
    const avg = price;
    const tpPrice = tpPriceFor(side, avg, tpPct);
    const leg: PaperSupertrendLeg = {
      ts: new Date(ctx.ts).toISOString(),
      price,
      notionalUsdt: legN,
      qty,
    };
    const created = await this.deps.repo.createOpen({
      pair,
      side,
      capitalUsdt: cap,
      legs: [leg],
      avgEntry: avg,
      totalNotionalUsdt: legN,
      tpPrice,
      tpPct,
      metadata: {},
    });
    if (!created) {
      this.deps.logger.error({ mod: 'paper.supertrend', pair }, 'createOpen conflict or failed — unique open per pair');
      return null;
    }
    this.maxLegWarnOnce.delete(pair);
    this.capitalLegWarnOnce.delete(pair);
    const markP = Number.isFinite(markNum) ? markPnlPct(side, avg, markNum) : 0;
    return this.paperSignal({
      type: 'paper.supertrend.entry',
      severity: 'info',
      side,
      confidence: 1,
      reason: `Supertrend flip → paper ${side} leg 1 @ ${price.toFixed(4)}`,
      entry: String(avg),
      takeProfit: String(tpPrice),
      meta: {
        pair,
        side,
        entryPrice: avg,
        tpPrice,
        tpPct,
        legCount: 1,
        totalNotionalUsdt: legN,
        markPnlPct: markP,
      },
    });
  }

  private async emitTakeProfit(
    ctx: StrategyContext,
    pos: PaperSupertrendPosition,
    exitPrice: number,
  ): Promise<StrategySignal> {
    const pnlU = realizedPnlUsdt(pos.side, pos.legs, exitPrice);
    const pnlPctVsCap = pos.capitalUsdt > 0 ? (pnlU / pos.capitalUsdt) * 100 : 0;
    const openedMs = new Date(pos.legs[0]!.ts).getTime();
    const holdDurationMs = ctx.ts - openedMs;
    const barMs = tfToMs(this.deps.PAPER_SUPERTREND_TF);
    const barsHeld = Math.max(1, Math.floor(holdDurationMs / barMs) + 1);
    await this.deps.repo.closeTp({
      id: pos.id,
      realizedPnlUsdt: pnlU,
      realizedPnlPct: pnlPctVsCap,
      metadata: { holdDurationMs, barsHeld, exitPrice },
    });
    this.maxLegWarnOnce.delete(pos.pair);
    this.capitalLegWarnOnce.delete(pos.pair);
    return this.paperSignal({
      type: 'paper.supertrend.tp',
      severity: 'info',
      side: pos.side,
      confidence: 1,
      reason: `TP hit @ ${exitPrice.toFixed(4)} — closing paper ${pos.side}`,
      entry: String(pos.avgEntry),
      takeProfit: String(pos.tpPrice),
      meta: {
        pair: pos.pair,
        side: pos.side,
        entryPrice: pos.avgEntry,
        tpPrice: pos.tpPrice,
        tpPct: pos.tpPct,
        legCount: pos.legs.length,
        totalNotionalUsdt: pos.totalNotionalUsdt,
        realizedPnlUsdt: pnlU,
        realizedPnlPct: pnlPctVsCap,
        legs: pos.legs,
        holdDurationMs,
        barsHeld,
        exitPrice,
      },
    });
  }

  private async tryAddLeg(
    ctx: StrategyContext,
    pos: PaperSupertrendPosition,
    markNum: number,
  ): Promise<StrategySignal | null> {
    const cap = pos.capitalUsdt;
    const targetLeg = baseLegNotional(cap, this.deps.PAPER_SUPERTREND_LEG_PCT);
    const used = allocatedNotional(pos.legs);
    const remaining = cap - used;
    if (remaining < targetLeg - 1e-6) {
      if (this.capitalLegWarnOnce.has(pos.pair)) return null;
      this.capitalLegWarnOnce.add(pos.pair);
      return this.paperSignal({
        type: 'paper.supertrend.warn',
        severity: 'warn',
        side: pos.side,
        confidence: 0.5,
        reason: 'Remaining capital below leg size; DCA skipped',
        entry: String(pos.avgEntry),
        takeProfit: String(pos.tpPrice),
        meta: {
          pair: pos.pair,
          side: pos.side,
          entryPrice: pos.avgEntry,
          tpPrice: pos.tpPrice,
          tpPct: pos.tpPct,
          legCount: pos.legs.length,
          totalNotionalUsdt: pos.totalNotionalUsdt,
          markPnlPct: markPnlPct(pos.side, pos.avgEntry, markNum),
          warnKind: 'capital',
          remainingCapitalUsdt: remaining,
          legTargetUsdt: targetLeg,
        },
      });
    }
    const addNotional = Math.min(targetLeg, remaining);
    const price = markNum;
    const qty = addNotional / price;
    const newLeg: PaperSupertrendLeg = {
      ts: new Date(ctx.ts).toISOString(),
      price,
      notionalUsdt: addNotional,
      qty,
    };
    const priorAvg = pos.avgEntry;
    const legs = [...pos.legs, newLeg];
    const avg = weightedAvgEntry(legs);
    const tpPct = this.deps.PAPER_SUPERTREND_ADD_TP_PCT;
    const tpPrice = tpPriceFor(pos.side, avg, tpPct);
    const totalNotional = used + addNotional;
    await this.deps.repo.appendLeg({
      id: pos.id,
      legs,
      avgEntry: avg,
      totalNotionalUsdt: totalNotional,
      tpPrice,
      tpPct,
      metadata: {},
    });
    this.capitalLegWarnOnce.delete(pos.pair);
    return this.paperSignal({
      type: 'paper.supertrend.add',
      severity: 'info',
      side: pos.side,
      confidence: 1,
      reason: `DD ≤ -${this.deps.PAPER_SUPERTREND_DD_TRIGGER_PCT}% — add leg ${legs.length} @ ${price.toFixed(4)}`,
      entry: String(avg),
      takeProfit: String(tpPrice),
      meta: {
        pair: pos.pair,
        side: pos.side,
        entryPrice: avg,
        priorAvgEntry: priorAvg,
        tpPrice,
        tpPct,
        legCount: legs.length,
        totalNotionalUsdt: totalNotional,
        markPnlPct: markPnlPct(pos.side, priorAvg, markNum),
        addNotionalUsdt: addNotional,
      },
    });
  }
}
