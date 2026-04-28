import type { ClosedTrade } from './simulator';

export interface BacktestMetrics {
  totalPnl: number;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
}

export function computeMetrics(trades: ClosedTrade[]): BacktestMetrics {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return { totalPnl: 0, tradeCount: 0, winRate: 0, profitFactor: 0, sharpe: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0 };
  }
  let totalPnl = 0, wins = 0, gross = 0, grossLoss = 0;
  let runningEquity = 0, peak = 0, maxDD = 0;
  const returns: number[] = [];
  for (const t of trades) {
    totalPnl += t.pnl;
    if (t.pnl > 0) { wins++; gross += t.pnl; } else { grossLoss += Math.abs(t.pnl); }
    runningEquity += t.pnl;
    if (runningEquity > peak) peak = runningEquity;
    const dd = peak - runningEquity;
    if (dd > maxDD) maxDD = dd;
    returns.push(t.pnl);
  }
  const avg = totalPnl / tradeCount;
  const variance = returns.reduce((acc, r) => acc + (r - avg) ** 2, 0) / tradeCount;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev === 0 ? 0 : avg / stdev;
  const losses = tradeCount - wins;
  return {
    totalPnl,
    tradeCount,
    winRate: wins / tradeCount,
    profitFactor: grossLoss === 0 ? Infinity : gross / grossLoss,
    sharpe,
    maxDrawdown: maxDD,
    avgWin: wins === 0 ? 0 : gross / wins,
    avgLoss: losses === 0 ? 0 : grossLoss / losses,
  };
}
