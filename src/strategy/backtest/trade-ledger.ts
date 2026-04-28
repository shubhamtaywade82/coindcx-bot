import { writeFileSync } from 'fs';
import type { ClosedTrade } from './simulator';

const HEADER = 'openedAt,closedAt,side,entry,stopLoss,takeProfit,exitPrice,exitReason,pnl,reason';

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportLedgerCsv(path: string, trades: ClosedTrade[]): void {
  const lines = [HEADER];
  for (const t of trades) {
    lines.push([
      t.openedAt, t.closedAt, t.side, t.entry, t.stopLoss, t.takeProfit,
      t.exitPrice, t.exitReason, t.pnl, csvEscape(t.reason ?? ''),
    ].join(','));
  }
  writeFileSync(path, lines.join('\n') + '\n');
}
