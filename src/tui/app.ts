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

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'CoinDCX Bot Replication',
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.tickerTable = this.grid.set(0, 0, 6, 6, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      label: 'Tickers',
      width: '50%',
      height: '50%',
      border: { type: 'line', fg: 'cyan' },
      columnSpacing: 10,
      columnWidth: [15, 10, 10],
    });

    this.positionTable = this.grid.set(0, 6, 6, 6, contrib.table, {
      label: 'Futures Positions',
      columnSpacing: 5,
      columnWidth: [15, 8, 8, 10, 10],
    });

    this.balanceTable = this.grid.set(6, 6, 3, 6, contrib.table, {
      label: 'Balances',
      columnSpacing: 5,
      columnWidth: [10, 15, 15],
    });

    this.logPanel = this.grid.set(6, 0, 6, 6, blessed.log, {
      label: 'System Logs',
      border: { type: 'line', fg: 'green' },
    });

    this.screen.key(['escape', 'q', 'C-c'], () => {
      process.exit(0);
    });

    this.log(`Bot started in ${config.isReadOnly ? 'READ-ONLY' : 'LIVE'} mode`);
  }

  render() {
    this.screen.render();
  }

  log(message: string) {
    this.logPanel.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  updateTickers(data: any[][]) {
    this.tickerTable.setData({
      headers: ['Pair', 'Price', 'Change'],
      data: data,
    });
    this.render();
  }

  updatePositions(data: any[][]) {
    this.positionTable.setData({
      headers: ['Pair', 'Side', 'Lev', 'Entry', 'PnL'],
      data: data,
    });
    this.render();
  }

  updateBalances(data: any[][]) {
    this.balanceTable.setData({
      headers: ['Asset', 'Balance', 'Locked'],
      data: data,
    });
    this.render();
  }
}
