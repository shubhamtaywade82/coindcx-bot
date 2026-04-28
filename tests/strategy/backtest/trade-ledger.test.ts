import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportLedgerCsv } from '../../../src/strategy/backtest/trade-ledger';
import type { ClosedTrade } from '../../../src/strategy/backtest/simulator';

const t: ClosedTrade = {
  side: 'LONG', entry: 100, stopLoss: 95, takeProfit: 110,
  openedAt: 1000, closedAt: 2000, exitPrice: 110, exitReason: 'tp', pnl: 10, reason: 'r',
};

describe('exportLedgerCsv', () => {
  it('writes header + rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'f4-'));
    const path = join(dir, 'trades.csv');
    exportLedgerCsv(path, [t]);
    const text = readFileSync(path, 'utf8');
    const [header, row] = text.trim().split('\n');
    expect(header).toMatch(/openedAt,closedAt,side,entry,stopLoss,takeProfit,exitPrice,exitReason,pnl,reason/);
    expect(row).toContain('LONG');
    expect(row).toContain('10');
  });
});
