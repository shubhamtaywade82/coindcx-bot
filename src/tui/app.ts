import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { config } from '../config/config';

export class TuiApp {
  private screen: blessed.Widgets.Screen;
  private grid: contrib.grid;
  private logPanel: blessed.Widgets.Log;
  private tickerTable: any;
  private positionTable: any;
  private balanceTable: any;
  private tradeTable: any;
  private orderTable: any;
  private statusBar: blessed.Widgets.BoxElement;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'CoinDCX Terminal',
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // ── Top-Left: Market Watch (rows 0-6, cols 0-6) ──
    this.tickerTable = this.grid.set(0, 0, 6, 6, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'black',
      selectedBg: 'cyan',
      interactive: true,
      label: ' ◉ Market Watch ',
      border: { type: 'line', fg: 'cyan' },
      columnSpacing: 2,
      columnWidth: [16, 14, 10],
    });

    // ── Top-Right: Futures Positions (rows 0-4, cols 6-12) ──
    this.positionTable = this.grid.set(0, 6, 4, 6, contrib.table, {
      label: ' ◉ Futures Positions ',
      border: { type: 'line', fg: 'yellow' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [14, 6, 5, 12, 12, 10],
    });

    // ── Mid-Right: Open Orders (rows 4-6, cols 6-12) ──
    this.orderTable = this.grid.set(4, 6, 2, 6, contrib.table, {
      label: ' ◉ Open Orders ',
      border: { type: 'line', fg: 'magenta' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [14, 6, 10, 10, 10],
    });

    // ── Mid-Left: Recent Trades (rows 6-9, cols 0-6) ──
    this.tradeTable = this.grid.set(6, 0, 3, 6, contrib.table, {
      label: ' ◉ Recent Trades ',
      border: { type: 'line', fg: 'blue' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [10, 14, 12, 10, 6],
    });

    // ── Mid-Right: Balances (rows 6-9, cols 6-12) ──
    this.balanceTable = this.grid.set(6, 6, 3, 6, contrib.table, {
      label: ' ◉ Account Balances ',
      border: { type: 'line', fg: 'green' },
      fg: 'white',
      columnSpacing: 2,
      columnWidth: [10, 16, 16],
    });

    // ── Bottom: System Logs (rows 9-12, cols 0-12) ──
    this.logPanel = this.grid.set(9, 0, 3, 12, blessed.log, {
      label: ' ◉ System Logs ',
      border: { type: 'line', fg: 'gray' },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', inverse: true },
    });

    // ── Keyboard shortcuts ──
    this.screen.key(['escape', 'q', 'C-c'], () => {
      process.exit(0);
    });

    const mode = config.isReadOnly ? 'READ-ONLY' : 'LIVE';
    this.log(`CoinDCX Terminal started [${mode}] — Pairs: ${config.pairs.join(', ')}`);
    this.log('Press q/ESC to quit');
  }

  render() {
    this.screen.render();
  }

  log(message: string) {
    this.logPanel.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  updateTickers(data: string[][]) {
    this.tickerTable.setData({
      headers: ['Pair', 'Price', 'Chg%'],
      data: data,
    });
    this.render();
  }

  updatePositions(data: string[][]) {
    this.positionTable.setData({
      headers: ['Pair', 'Side', 'Lev', 'Entry', 'Mark', 'PnL'],
      data: data,
    });
    this.render();
  }

  updateBalances(data: string[][]) {
    this.balanceTable.setData({
      headers: ['Asset', 'Available', 'Locked'],
      data: data,
    });
    this.render();
  }

  updateTrades(data: string[][]) {
    this.tradeTable.setData({
      headers: ['Time', 'Pair', 'Price', 'Qty', 'Side'],
      data: data,
    });
    this.render();
  }

  updateOrders(data: string[][]) {
    this.orderTable.setData({
      headers: ['Pair', 'Side', 'Price', 'Qty', 'Status'],
      data: data,
    });
    this.render();
  }
}
