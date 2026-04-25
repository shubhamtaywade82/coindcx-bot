import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { config } from '../config/config';
import { cleanPair } from '../utils/format';

export class TuiApp {
  private screen: blessed.Widgets.Screen;
  private grid: contrib.grid;
  private logPanel: blessed.Widgets.Log;
  private statusBar: blessed.Widgets.BoxElement;
  private summaryBox: blessed.Widgets.BoxElement;
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
      title: 'SMC Alpha Terminal',
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // ── Row 0: Top Status Bar ──
    this.statusBar = this.grid.set(0, 0, 1, 12, blessed.box, {
      tags: true,
      content: this.buildStatusContent(),
      style: { bg: 'black' }
    });

    // ── Row 1: Account Summary Bar ──
    this.summaryBox = this.grid.set(1, 0, 1, 12, blessed.box, {
      tags: true,
      content: ' {yellow-fg}Loading account stats...{/yellow-fg}',
      style: { bg: 'black' }
    });

    // ── Row 2: Asset Header Bar ──
    this.headerBox = this.grid.set(2, 0, 1, 12, blessed.box, {
      label: ' ◈ Asset Focus ',
      border: { type: 'line', fg: 'cyan' },
      style: { fg: 'white', bold: true },
      tags: true,
      content: this.buildHeaderContent(),
    });

    // ── Row 3-7, Col 0-3: Live Trades (Focused) ──
    this.tradeTable = this.grid.set(3, 0, 5, 3, contrib.table, {
      label: ' ◉ Book ',
      border: { type: 'line', fg: 'blue' },
      fg: 'white',
      columnSpacing: 1,
      columnWidth: [3, 10, 10],
      tags: true,
    });

    // ── Row 3-7, Col 3-9: Positions (All) ──
    this.positionTable = this.grid.set(3, 3, 5, 6, contrib.table, {
      label: ' ◉ Positions ',
      border: { type: 'line', fg: 'yellow' },
      fg: 'white',
      columnSpacing: 1,
      columnWidth: [8, 8, 8, 10, 10, 10, 6, 12],
      tags: true,
    });

    // ── Row 3-7, Col 9-12: Orders (All) ──
    this.orderTable = this.grid.set(3, 9, 5, 3, contrib.table, {
      label: ' ◉ Orders ',
      border: { type: 'line', fg: 'magenta' },
      fg: 'white',
      columnSpacing: 1,
      columnWidth: [4, 10, 8, 8],
      tags: true,
    });

    // ── Row 8-11, Col 0-7: Account Balances ──
    this.balanceTable = this.grid.set(8, 0, 4, 7, contrib.table, {
      label: ' ◉ Account Balances ',
      border: { type: 'line', fg: 'green' },
      fg: 'white',
      columnSpacing: 1,
      columnWidth: [6, 12, 12, 12, 10, 10],
      tags: true,
    });

    // ── Row 8-11, Col 7-12: Log Panel ──
    this.logPanel = this.grid.set(8, 7, 4, 5, blessed.log, {
      label: ' ◉ System Logs ',
      border: { type: 'line', fg: 'gray' },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', inverse: true },
    });

    // ── Keyboard Shortcuts ──
    this.screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

    // Arrow keys to switch focused pair
    this.screen.key(['left', 'h', 'S-tab'], () => this.switchFocus(-1));
    this.screen.key(['right', 'l', 'tab'], () => this.switchFocus(1));

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
    this.log('Controls: ← →, h/l, or Tab to switch pair | 1-9 direct select | q to quit');
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
    let newIndex = this.focusIndex + direction;
    if (newIndex < 0) newIndex = this.pairs.length - 1;
    if (newIndex >= this.pairs.length) newIndex = 0;
    
    if (this.focusIndex !== newIndex) {
      this.focusIndex = newIndex;
      this.emitFocusChange();
    }
  }

  private buildStatusContent() {
    const mode = config.isReadOnly ? '{red-fg}READ-ONLY{/red-fg}' : '{green-fg}LIVE{/green-fg}';
    const exe = config.isReadOnly ? '{yellow-fg}OFF{/yellow-fg}' : '{green-fg}RUN{/green-fg}';
    return ` MODE: ${mode}  │  EXE: ${exe}  │  REGIME: {green-fg}LIVE{/green-fg}  │  ENGINE: {green-fg}RUN{/green-fg}  │  WS: {green-fg}●{/green-fg}  │  FEED: {green-fg}OK{/green-fg}  │  FOCUS: {cyan-fg}${this.focusedPairClean}{/cyan-fg}  │  LAT: {cyan-fg}24ms{/cyan-fg}`;
  }

  updateStatus() {
    this.statusBar.setContent(this.buildStatusContent());
    this.render();
  }

  updateSummary(data: { equity: string; wallet: string; net: string; unrealUsdt: string }) {
    this.summaryBox.setContent(` EQ: {green-fg}${data.equity}{/green-fg}  │  WAL: {green-fg}${data.wallet}{/green-fg}  │  NET: {green-fg}${data.net}{/green-fg}  │  UNREAL USDT: {cyan-fg}${data.unrealUsdt}{/cyan-fg}`);
    this.render();
  }

  private emitFocusChange() {
    this.updateHeader();
    this.updateStatus();
    this.tradeTable.setLabel(` ◉ Book — ${this.focusedPairClean} `);
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
      headers: ['S', 'PRICE', 'QTY'],
      data,
    });
    this.render();
  }

  updatePositions(data: string[][]) {
    this.positionTable.setData({
      headers: ['SYM', 'SIDE', 'QTY', 'ENT', 'LAST', 'MARK', 'SL', 'PNL'],
      data,
    });
    this.render();
  }

  updateBalances(rows: string[][]) {
    this.balanceTable.setData({
      headers: ['Asset', 'Current Value', 'Wallet Balance', 'Active PnL', 'Available', 'Locked'],
      data: rows,
    });
    this.render();
  }

  updateOrders(data: string[][]) {
    this.orderTable.setData({
      headers: ['T', 'PAIR', 'ST', 'LAT'],
      data,
    });
    this.render();
  }
}
