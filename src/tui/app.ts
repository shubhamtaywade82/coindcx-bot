import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { config } from '../config/config';
import { cleanPair } from '../utils/format';

export class TuiApp {
  private screen: any;
  private grid: any;
  private logPanel: any;
  private statusBar: any;
  private summaryBox: any;
  private headerBox: any;
  private tradeTable: any;
  private positionTable: any;
  private orderTable: any;
  private balanceTable: any;
  private aiBox: any;

  // ── Asset Focus State ──
  private pairs: string[];
  private focusIndex: number = 0;
  private onFocusChange?: (pair: string) => void;

  // ── TUI Status Flags (Passed from index) ──
  private isConnected: boolean = false;
  private latency: number = 0;
  private lastUpdate: number = 0;

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
      content: ' LOADING...',
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

    // ── Row 3-8, Col 0-3: Book (Focused) ──
    this.tradeTable = this.grid.set(3, 0, 5, 3, blessed.box, {
      label: ' ◉ Book ',
      border: { type: 'line', fg: 'blue' },
      style: { fg: 'white' },
      tags: true,
      content: ' {gray-fg}PRICE      AMOUNT      SUM{/gray-fg}',
      scrollable: true
    });

    // ── Row 3-8, Col 3-6: AI Analysis ──
    this.aiBox = this.grid.set(3, 3, 5, 3, blessed.box, {
      label: ' ◈ AI Strategy Pulse ',
      border: { type: 'line', fg: 'cyan' },
      tags: true,
      content: ' {gray-fg}Analyzing market pulse...{/gray-fg}',
      style: { fg: 'white' }
    });

    // ── Row 3-8, Col 6-12: Positions (All) ──
    this.positionTable = this.grid.set(3, 6, 5, 6, blessed.box, {
      label: ' ◉ Positions ',
      border: { type: 'line', fg: 'yellow' },
      style: { fg: 'white' },
      tags: true,
      content: ' {yellow-fg}SYM     SIDE      QTY         ENT         PNL{/yellow-fg}',
      scrollable: true
    });

    // ── Row 8-10, Col 0-8: Account Balances ──
    this.balanceTable = this.grid.set(8, 0, 2, 8, blessed.box, {
      label: ' ◉ Account Balances ',
      border: { type: 'line', fg: 'green' },
      style: { fg: 'white' },
      tags: true,
      content: ' {green-fg}Asset       Current Value   Wallet Balance  Active PnL     Available   Locked{/green-fg}',
      scrollable: true
    });

    // ── Row 8-10, Col 8-12: Orders (All) ──
    this.orderTable = this.grid.set(8, 8, 2, 4, blessed.box, {
      label: ' ◉ Orders ',
      border: { type: 'line', fg: 'magenta' },
      style: { fg: 'white' },
      tags: true,
      content: ' {magenta-fg}T   PAIR        ST        LAT{/magenta-fg}',
      scrollable: true
    });

    // ── Row 10-12, Col 0-12: Log Panel ──
    this.logPanel = this.grid.set(10, 0, 2, 12, blessed.log, {
      label: ' ◉ System Logs ',
      border: { type: 'line', fg: 'gray' },
      scrollable: true,
      tags: true,
      style: { fg: 'gray' },
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

    const modeStr = config.isReadOnly ? 'READ-ONLY' : 'LIVE';
    this.log(`CoinDCX Terminal [${modeStr}] — ${this.pairs.length} pairs loaded`);
    this.log('Controls: ← →, h/l, or Tab to switch pair | 1-9 direct select | q to quit');

    this.updateStatus();
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
    const mode = config.isReadOnly ? '{red-fg}READ-ONLY{/red-fg}' : '{green-fg}ACTIVE{/green-fg}';
    const engine = '{green-fg}RUN{/green-fg}';
    const ws = this.isConnected ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
    const feed = this.lastUpdate > Date.now() - 5000 ? '{green-fg}OK{/green-fg}' : '{red-fg}ERR{/red-fg}';
    const lat = this.latency > 0 ? `${this.latency}ms` : '24ms'; // Mocking 24ms for now if 0
    return ` MODE: ${mode}  │  EXE: OFF  │  REGIME: LIVE  │  ENGINE: ${engine}  │  WS: ${ws}  │  FEED: ${feed}  │  FOCUS: ${this.focusedPairClean}  │  LAT: ${lat}`;
  }

  private buildHeaderContent() {
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

  updateStatus(data?: { connected?: boolean; latency?: number; lastUpdate?: number }) {
    if (data) {
      if (data.connected !== undefined) this.isConnected = data.connected;
      if (data.latency !== undefined) this.latency = data.latency;
      if (data.lastUpdate !== undefined) this.lastUpdate = data.lastUpdate;
    }
    this.statusBar.setContent(this.buildStatusContent());
    this.render();
  }

  updateSummary(data: { equity: string; wallet: string; net: string; unrealUsdt: string }) {
    this.summaryBox.setContent(` EQ: {green-fg}${data.equity}{/green-fg}  │  WAL: {green-fg}${data.wallet}{/green-fg}  │  NET: ${data.net}  │  UNREAL USDT: {cyan-fg}${data.unrealUsdt}{/cyan-fg}`);
    this.render();
  }

  updateFocus(data: { symbol: string; ltp: string; mark: string; change24h: string }) {
    this.updateHeader({ ltp: data.ltp, mark: data.mark, change: data.change24h });
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

  updateHeader(stats?: { ltp?: string; mark?: string; change?: string; vol?: string }) {
    let content = this.buildHeaderContent();
    if (stats) {
      const s: string[] = [];
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

  private pad(str: string, width: number) {
    const plain = str.replace(/\{[^\}]+\}/g, '');
    const len = plain.length;
    if (len >= width) return str;
    return str + ' '.repeat(width - len);
  }

  updateOrderBook(asks: string[][], bids: string[][], lastPrice: string) {
    const _totalWidth = 26;
    const header = ' {gray-fg}PRICE      AMOUNT      SUM{/gray-fg}\n';
    
    // Asks (Red) - Should be descending from top to spread
    const askRows = asks.slice(0, 10).map(row => {
      const price = `{red-fg}${this.pad(row[0], 10)}{/red-fg}`;
      const amount = this.pad(row[1], 10);
      const sum = row[2];
      return ` ${price}${amount}${sum}`;
    }).reverse();

    // Last Price Row
    const ltpRow = `\n {bold}${this.pad(lastPrice, 10)}{/bold}\n`;

    // Bids (Green) - Should be descending
    const bidRows = bids.slice(0, 10).map(row => {
      const price = `{green-fg}${this.pad(row[0], 10)}{/green-fg}`;
      const amount = this.pad(row[1], 10);
      const sum = row[2];
      return ` ${price}${amount}${sum}`;
    });

    const asksHeader = ' {red-fg}---- ASKS ----{/red-fg}\n';
    const bidsHeader = '\n {green-fg}---- BIDS ----{/green-fg}\n';

    this.tradeTable.setContent(header + asksHeader + askRows.join('\n') + ltpRow + bidsHeader + bidRows.join('\n'));
    this.render();
  }

  updateAi(data: { verdict: string; signal: string; confidence: number }) {
    const color = data.signal === 'BUY' ? 'green' : data.signal === 'SELL' ? 'red' : 'yellow';
    const content = `\n {bold}${data.verdict}{/bold}\n\n {${color}-fg}SIGNAL: ${data.signal}{/${color}-fg}\n {gray-fg}CONF: ${(data.confidence * 100).toFixed(0)}%{/gray-fg}`;
    this.aiBox.setContent(content);
    this.render();
  }

  updatePositions(data: string[][]) {
    let content = ' {yellow-fg}SYM     SIDE      QTY         ENT         PNL{/yellow-fg}\n';
    content += data.map(row => {
      // row: [sym, side, qty, ent, last, mark, sl, pnl]
      // Widening columns for better spacing
      const sym = this.pad(row[0] || '', 8);
      const side = this.pad(row[1] || '', 10);
      const qty = this.pad(row[2] || '', 12);
      const ent = this.pad(row[3] || '', 12);
      const pnl = row[7] || '';
      return ` ${sym}${side}${qty}${ent}${pnl}`;
    }).join('\n');
    this.positionTable.setContent(content);
    this.render();
  }

  updateBalances(rows: string[][]) {
    let content = ' {green-fg}Asset       Value       Wallet      PnL        %           Available   Locked      Util%{/green-fg}\n';
    content += rows.map(row => {
      // row: [asset, val, wal, pnl, pnl%, avail, locked, util%]
      return ` ${this.pad(row[0] || '', 12)}${this.pad(row[1] || '', 12)}${this.pad(row[2] || '', 12)}${this.pad(row[3] || '', 11)}${this.pad(row[4] || '', 12)}${this.pad(row[5] || '', 12)}${this.pad(row[6] || '', 12)}${row[7] || ''}`;
    }).join('\n');
    this.balanceTable.setContent(content);
    this.render();
  }

  updateOrders(data: string[][]) {
    let content = ' {magenta-fg}T   PAIR        ST        LAT{/magenta-fg}\n';
    content += data.map(row => {
      return ` ${this.pad(row[0], 4)}${this.pad(row[1], 12)}${this.pad(row[2], 10)}${row[3]}`;
    }).join('\n');
    this.orderTable.setContent(content);
    this.render();
  }
}

