import type { BookTopN } from './types';
import type { TradeFlow, TradeTick, TradeWindowMetrics } from './trade-flow';

export interface TopNBookImbalanceInput {
  top: BookTopN;
}

export interface TopNBookImbalance {
  bidVolume: number;
  askVolume: number;
  imbalanceRatio: number;
  imbalance: 'bid-heavy' | 'ask-heavy' | 'neutral';
}

export interface CvdMetrics {
  cvd: number;
  shortWindowDelta: number;
  longWindowDelta: number;
}

export interface AggressorRatioMetrics {
  buyAggressiveVolume: number;
  sellAggressiveVolume: number;
  ratio: number;
}

export interface TapeSpeedAccelerationMetrics {
  shortTrades: number;
  longTrades: number;
  shortTps: number;
  longTps: number;
  acceleration: number;
}

export interface SweepDetectionMetrics {
  detected: boolean;
  side: 'buy' | 'sell' | 'none';
  burstTrades: number;
  burstVolume: number;
  burstStartTs?: number;
  burstEndTs?: number;
}

export interface IcebergSpoofHeuristics {
  icebergLikely: boolean;
  spoofLikely: boolean;
  consecutiveAbsorptions: number;
  rapidBookFlips: number;
}

export interface MicrostructureMetrics {
  topNImbalance: TopNBookImbalance;
  cvd: CvdMetrics;
  aggressorRatio: AggressorRatioMetrics;
  tapeSpeedAcceleration: TapeSpeedAccelerationMetrics;
  sweep: SweepDetectionMetrics;
  icebergSpoof: IcebergSpoofHeuristics;
}

export interface ComputeMicrostructureInput {
  pair: string;
  top: BookTopN;
  tradeFlow?: TradeFlow;
  nowMs?: number;
}

const NEUTRAL_IMBALANCE_BAND = 0.1;
const SHORT_WINDOW_MS = 15_000;
const LONG_WINDOW_MS = 60_000;
const SWEEP_BURST_WINDOW_MS = 200;
const SWEEP_MIN_TRADES = 3;
const SWEEP_MIN_VOLUME = 3;
const ICEBERG_VOLUME_THRESHOLD = 2;
const SPOOF_IMBALANCE_DELTA_THRESHOLD = 0.35;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sumQty(levels: ReadonlyArray<{ qty: string }>): number {
  return levels.reduce((acc, level) => acc + finite(Number(level.qty)), 0);
}

function windowMetricsOrEmpty(
  metrics: TradeWindowMetrics | null,
  windowMs: number,
): TradeWindowMetrics {
  if (metrics) return metrics;
  return {
    windowMs,
    trades: 0,
    buyVol: 0,
    sellVol: 0,
    totalVol: 0,
    delta: 0,
    imbalance: 0,
  };
}

function classifyImbalance(ratio: number): TopNBookImbalance['imbalance'] {
  if (ratio > NEUTRAL_IMBALANCE_BAND) return 'bid-heavy';
  if (ratio < -NEUTRAL_IMBALANCE_BAND) return 'ask-heavy';
  return 'neutral';
}

function detectSweep(ticks: TradeTick[]): SweepDetectionMetrics {
  if (ticks.length < SWEEP_MIN_TRADES) {
    return { detected: false, side: 'none', burstTrades: ticks.length, burstVolume: 0 };
  }
  let best: SweepDetectionMetrics = {
    detected: false,
    side: 'none',
    burstTrades: 0,
    burstVolume: 0,
  };

  for (let start = 0; start < ticks.length; start += 1) {
    const startTick = ticks[start]!;
    let buyTrades = 0;
    let sellTrades = 0;
    let buyVolume = 0;
    let sellVolume = 0;

    for (let end = start; end < ticks.length; end += 1) {
      const endTick = ticks[end]!;
      if (endTick.ts - startTick.ts > SWEEP_BURST_WINDOW_MS) break;
      if (endTick.buyAggressive) {
        buyTrades += 1;
        buyVolume += endTick.qty;
      } else {
        sellTrades += 1;
        sellVolume += endTick.qty;
      }
      const burstTrades = buyTrades + sellTrades;
      if (burstTrades < SWEEP_MIN_TRADES) continue;
      const dominantSide = buyTrades > sellTrades ? 'buy' : sellTrades > buyTrades ? 'sell' : 'none';
      const dominantVolume = dominantSide === 'buy' ? buyVolume : dominantSide === 'sell' ? sellVolume : 0;
      if (dominantSide === 'none' || dominantVolume < SWEEP_MIN_VOLUME) continue;
      if (
        !best.detected ||
        burstTrades > best.burstTrades ||
        (burstTrades === best.burstTrades && dominantVolume > best.burstVolume)
      ) {
        best = {
          detected: true,
          side: dominantSide,
          burstTrades,
          burstVolume: dominantVolume,
          burstStartTs: startTick.ts,
          burstEndTs: endTick.ts,
        };
      }
    }
  }

  return best;
}

function icebergSpoofHeuristics(
  shortWindow: TradeWindowMetrics,
  longWindow: TradeWindowMetrics,
  sweep: SweepDetectionMetrics,
  topImbalance: TopNBookImbalance,
): IcebergSpoofHeuristics {
  const dominantAbsorption =
    shortWindow.buyVol > shortWindow.sellVol
      ? topImbalance.askVolume
      : shortWindow.sellVol > shortWindow.buyVol
        ? topImbalance.bidVolume
        : 0;
  const oppositeAggressionVolume = Math.max(shortWindow.buyVol, shortWindow.sellVol);
  const absorptionRatio =
    oppositeAggressionVolume > 0 ? dominantAbsorption / oppositeAggressionVolume : 0;
  const consecutiveAbsorptions =
    shortWindow.trades >= SWEEP_MIN_TRADES && absorptionRatio >= ICEBERG_VOLUME_THRESHOLD ? 1 : 0;

  const longImbalanceSign = Math.sign(longWindow.imbalance);
  const shortImbalanceSign = Math.sign(shortWindow.imbalance);
  const imbalanceFlipStrength = Math.abs(shortWindow.imbalance - longWindow.imbalance);
  const rapidBookFlips =
    longImbalanceSign !== 0 &&
    shortImbalanceSign !== 0 &&
    longImbalanceSign !== shortImbalanceSign &&
    imbalanceFlipStrength >= SPOOF_IMBALANCE_DELTA_THRESHOLD
      ? 1
      : 0;

  return {
    icebergLikely: consecutiveAbsorptions > 0 && !sweep.detected,
    spoofLikely: rapidBookFlips >= 1 && sweep.detected,
    consecutiveAbsorptions,
    rapidBookFlips,
  };
}

export function computeTopNBookImbalance(input: TopNBookImbalanceInput): TopNBookImbalance {
  const bidVolume = sumQty(input.top.bids);
  const askVolume = sumQty(input.top.asks);
  const total = bidVolume + askVolume;
  const imbalanceRatio = total > 0 ? (bidVolume - askVolume) / total : 0;
  return {
    bidVolume,
    askVolume,
    imbalanceRatio,
    imbalance: classifyImbalance(imbalanceRatio),
  };
}

export function computeMicrostructureMetrics(input: ComputeMicrostructureInput): MicrostructureMetrics {
  const nowMs = input.nowMs ?? Date.now();
  const topNImbalance = computeTopNBookImbalance({ top: input.top });

  const shortWindow = windowMetricsOrEmpty(
    input.tradeFlow?.windowMetrics(input.pair, SHORT_WINDOW_MS, nowMs) ?? null,
    SHORT_WINDOW_MS,
  );
  const longWindow = windowMetricsOrEmpty(
    input.tradeFlow?.windowMetrics(input.pair, LONG_WINDOW_MS, nowMs) ?? null,
    LONG_WINDOW_MS,
  );
  const ticks = input.tradeFlow?.ticks(input.pair, SHORT_WINDOW_MS, nowMs) ?? [];
  const sweep = detectSweep(ticks);
  const cvdValue = input.tradeFlow?.metrics(input.pair, nowMs)?.cvd ?? 0;

  const shortTps = shortWindow.windowMs > 0 ? shortWindow.trades / (shortWindow.windowMs / 1000) : 0;
  const longTps = longWindow.windowMs > 0 ? longWindow.trades / (longWindow.windowMs / 1000) : 0;

  const aggressorRatio =
    shortWindow.sellVol > 0
      ? shortWindow.buyVol / shortWindow.sellVol
      : shortWindow.buyVol > 0
        ? Number.POSITIVE_INFINITY
        : 0;

  return {
    topNImbalance,
    cvd: {
      cvd: cvdValue,
      shortWindowDelta: shortWindow.delta,
      longWindowDelta: longWindow.delta,
    },
    aggressorRatio: {
      buyAggressiveVolume: shortWindow.buyVol,
      sellAggressiveVolume: shortWindow.sellVol,
      ratio: aggressorRatio,
    },
    tapeSpeedAcceleration: {
      shortTrades: shortWindow.trades,
      longTrades: longWindow.trades,
      shortTps,
      longTps,
      acceleration: shortTps - longTps,
    },
    sweep,
    icebergSpoof: icebergSpoofHeuristics(shortWindow, longWindow, sweep, topNImbalance),
  };
}
