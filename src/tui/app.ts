import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { config } from '../config/config';
import { cleanPair } from '../utils/format';

export class TuiApp {
  private screen: blessed.Widgets.Screen;
  private grid: contrib.grid;
  private logPanel: blessed.Widgets.Log;
  private headerBox: any;
  private tradeTable: any;
  private positionTable: any;
  private orderTable: any;
  private balanceTable: any;

  // ── Asset Focus State ──
  private pairs: string[];
  private focusIndex: number = 0;
  private onFocusChange?: (pair: string) => void;

  constructor() {
    this.pairs = config.pairs;
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'CoinDCX Terminal',
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // ── Row 0-1: Asset Header Bar ──
    this.headerBox = this.grid.set(0, 0, 1, 12, blessed.box, {
      label: ' ◈ Asset Focus ',
      border: { type: 'line', fg: 'cyan' },
      style: { fg: 'white', bold: true },
      tags: true,
      content: this.buildHeaderContent(),
    });

    // ── Row 1-6, Col 0-6: Live Trades (focused pair) ──
    this.tradeTable = this.grid.set(1, 0, 5, 6, contrib.table, {
      label: ' ◉ Live Trades ',
      border: { type: 'line', fg: 'blue' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [10, 14, 12, 10, 6],
    });

    // ── Row 1-4, Col 6-12: Futures Positions (global) ──
    this.positionTable = this.grid.set(1, 6, 3, 6, contrib.table, {
      label: ' ◉ Futures Positions (All) ',
      border: { type: 'line', fg: 'yellow' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [14, 6, 5, 12, 12, 10],
    });

    // ── Row 4-6, Col 6-12: Open Orders (global) ──
    this.orderTable = this.grid.set(4, 6, 2, 6, contrib.table, {
      label: ' ◉ Open Orders (All) ',
      border: { type: 'line', fg: 'magenta' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [14, 6, 10, 10, 10],
    });

    // ── Row 6-9, Col 0-6: Account Balances (global) ──
    this.balanceTable = this.grid.set(6, 0, 3, 6, contrib.table, {
      label: ' ◉ Account Balances (All) ',
      border: { type: 'line', fg: 'green' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [10, 16, 16],
    });

    // ── Row 6-9, Col 6-12: Reserved / extra (logs overflow) ──
    // Using full-width logs below

    // ── Row 9-12: System Logs (full width) ──
    this.logPanel = this.grid.set(9, 0, 3, 12, blessed.log, {
      label: ' ◉ System Logs ',
      border: { type: 'line', fg: 'gray' },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', inverse: true },
    });

    // ── Keyboard Shortcuts ──
    this.screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

    // Arrow keys to switch focused pair
    this.screen.key(['left', 'h'], () => this.switchFocus(-1));
    this.screen.key(['right', 'l'], () => this.switchFocus(1));

    // Number keys for direct pair selection (1-9)
    for (let i = 1; i <= 9; i++) {
      this.screen.key([i.toString()], () => {
        if (i <= this.pairs.length) {
          this.focusIndex = i - 1;
          this.emitFocusChange();
        }
      });
    }

    const mode = config.isReadOnly ? 'READ-ONLY' : 'LIVE';
    this.log(`CoinDCX Terminal [${mode}] — ${this.pairs.length} pairs loaded`);
    this.log('Controls: ← → or h/l to switch pair | 1-9 direct select | q to quit');
  }

  // ── Focus Management ──

  get focusedPair(): string {
    return this.pairs[this.focusIndex] || this.pairs[0];
  }

  get focusedPairClean(): string {
    return cleanPair(this.focusedPair);
  }

  setOnFocusChange(callback: (pair: string) => void) {
    this.onFocusChange = callback;
  }

  private switchFocus(direction: number) {
    const newIndex = this.focusIndex + direction;
    if (newIndex >= 0 && newIndex < this.pairs.length) {
      this.focusIndex = newIndex;
      this.emitFocusChange();
    }
  }

  private emitFocusChange() {
    this.updateHeader();
    this.tradeTable.setLabel(` ◉ Live Trades — ${this.focusedPairClean} `);
    this.render();
    if (this.onFocusChange) {
      this.onFocusChange(this.focusedPair);
    }
    this.log(`Focused on: ${this.focusedPairClean}`);
  }

  private buildHeaderContent(): string {
    const parts = this.pairs.map((pair, i) => {
      const name = cleanPair(pair);
      if (i === this.focusIndex) {
        return `{cyan-fg}{bold}◉ ${name}{/bold}{/cyan-fg}`;
      }
      return `{gray-fg}○ ${name}{/gray-fg}`;
    });
    const selector = parts.join('  │  ');
    return `  ${selector}    {gray-fg}[← →]{/gray-fg} switch  {gray-fg}[1-${this.pairs.length}]{/gray-fg} select`;
  }

  // ── Update Methods ──

  updateHeader(stats?: { ltp?: string; mark?: string; change?: string; vol?: string }) {
    let content = this.buildHeaderContent();
    if (stats) {
      const s = [];
      if (stats.ltp) s.push(`LTP: {white-fg}${stats.ltp}{/white-fg}`);
      if (stats.mark) s.push(`Mark: {white-fg}${stats.mark}{/white-fg}`);
      if (stats.change) {
        const num = parseFloat(stats.change);
        const color = num >= 0 ? 'green' : 'red';
        s.push(`24h: {${color}-fg}${stats.change}{/${color}-fg}`);
      }
      if (stats.vol) s.push(`Vol: {white-fg}${stats.vol}{/white-fg}`);
      if (s.length > 0) content += `\n  ${s.join('  │  ')}`;
    }
    this.headerBox.setContent(content);
    this.render();
  }

  render() {
    this.screen.render();
  }

  log(message: string) {
    this.logPanel.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  updateTrades(data: string[][]) {
    this.tradeTable.setData({
      headers: ['Time', 'Pair', 'Price', 'Qty', 'Side'],
      data,
    });
    this.render();
  }

  updatePositions(data: string[][]) {
    this.positionTable.setData({
      headers: ['Pair', 'Side', 'Lev', 'Entry', 'Mark', 'PnL'],
      data,
    });
    this.render();
  }

  updateBalances(data: string[][]) {
    this.balanceTable.setData({
      headers: ['Asset', 'Available', 'Locked'],
      data,
    });
    this.render();
  }

  updateOrders(data: string[][]) {
    this.orderTable.setData({
      headers: ['Pair', 'Side', 'Price', 'Qty', 'Status'],
      data,
    });
    this.render();
  }
}
