import type { ClosedTrade } from './simulator';

export interface BacktestMetrics {
  totalPnl: number;
  tradeCount: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  sharpe: number;
  calmar: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  annualizedReturn: number;
  medianTimeToOneRMs: number;
  breakevenLockBeforeNegativeCloseRate: number;
  avgWin: number;
  avgLoss: number;
}

export function computeMetrics(trades: ClosedTrade[]): BacktestMetrics {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return {
      totalPnl: 0,
      tradeCount: 0,
      winRate: 0,
      avgR: 0,
      profitFactor: 0,
      sharpe: 0,
      calmar: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      annualizedReturn: 0,
      medianTimeToOneRMs: 0,
      breakevenLockBeforeNegativeCloseRate: 0,
      avgWin: 0,
      avgLoss: 0,
    };
  }
  let totalPnl = 0, wins = 0, gross = 0, grossLoss = 0;
  let runningEquity = 0, peak = 0, maxDD = 0;
  const pnlReturns: number[] = [];
  const rMultiples: number[] = [];
  const timeToOneRSeries: number[] = [];
  let negativeCloseCount = 0;
  let breakevenBeforeNegativeCloseCount = 0;
  const openedAtSeries: number[] = [];
  const closedAtSeries: number[] = [];
  for (const t of trades) {
    totalPnl += t.pnl;
    if (t.pnl > 0) { wins++; gross += t.pnl; } else { grossLoss += Math.abs(t.pnl); }
    runningEquity += t.pnl;
    if (runningEquity > peak) peak = runningEquity;
    const dd = peak - runningEquity;
    if (dd > maxDD) maxDD = dd;
    pnlReturns.push(t.pnl);
    rMultiples.push(Number.isFinite(t.rMultiple) ? t.rMultiple : 0);
    if (t.timeToOneRMs !== undefined && Number.isFinite(t.timeToOneRMs)) {
      timeToOneRSeries.push(t.timeToOneRMs);
    }
    if (t.closedInNegativePnl) {
      negativeCloseCount += 1;
      if (t.reachedBreakevenLock) breakevenBeforeNegativeCloseCount += 1;
    }
    openedAtSeries.push(t.openedAt);
    closedAtSeries.push(t.closedAt);
  }
  const avg = totalPnl / tradeCount;
  const variance = pnlReturns.reduce((acc, r) => acc + (r - avg) ** 2, 0) / tradeCount;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev === 0 ? 0 : avg / stdev;
  const avgR = rMultiples.reduce((acc, value) => acc + value, 0) / tradeCount;
  const losses = tradeCount - wins;
  const maxDrawdownPct = peak > 0 ? maxDD / peak : 0;
  const annualizedReturn = annualizedPnlReturn(totalPnl, openedAtSeries, closedAtSeries);
  const calmar = maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : 0;
  const medianTimeToOneRMs = median(timeToOneRSeries);
  const breakevenLockBeforeNegativeCloseRate =
    negativeCloseCount > 0 ? breakevenBeforeNegativeCloseCount / negativeCloseCount : 1;
  return {
    totalPnl,
    tradeCount,
    winRate: wins / tradeCount,
    avgR,
    profitFactor: grossLoss === 0 ? Infinity : gross / grossLoss,
    sharpe,
    calmar,
    maxDrawdown: maxDD,
    maxDrawdownPct,
    annualizedReturn,
    medianTimeToOneRMs,
    breakevenLockBeforeNegativeCloseRate,
    avgWin: wins === 0 ? 0 : gross / wins,
    avgLoss: losses === 0 ? 0 : grossLoss / losses,
  };
}

function annualizedPnlReturn(totalPnl: number, openedAtSeries: number[], closedAtSeries: number[]): number {
  if (openedAtSeries.length === 0 || closedAtSeries.length === 0) return 0;
  const start = Math.min(...openedAtSeries);
  const end = Math.max(...closedAtSeries);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const years = (end - start) / (365 * 24 * 60 * 60_000);
  if (years <= 0) return 0;
  return totalPnl / years;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}
