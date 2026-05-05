import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import { config } from '../config/config';
import { cleanPair, formatPrice, formatQty, toCoinDcxFuturesInstrument } from '../utils/format';

interface AiPanelState {
  verdict: string;
  signal: string;
  confidence: number;
  no_trade_condition?: string;
  entry?: string;
  stopLoss?: string;
  takeProfit?: string;
  rr?: number;
  levels?: string[];
  management?: string;
  currentBias?: string;
  expectedNextBias?: string;
  biasTrigger?: string;
}

interface MtfBar {
  close: number;
  volume: number;
  trend: 'up' | 'down' | 'sideways';
}

interface MtfPanelState {
  tf1m?: MtfBar;
  tf15m?: MtfBar;
  tf1h?: MtfBar;
  bookImbalance?: 'bid-heavy' | 'ask-heavy' | 'neutral';
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
}

type SystemLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Portfolio strip shown inside the Balances panel (same figures as former top summary). */
export type BalancePanelTotals = {
  equity: string;
  wallet: string;
  /** Unrealized PnL — plain `₹… (… USDT)` (no tags); color uses `urInr`. */
  ur: string;
  urInr: number;
  /** INR totals for strip coloring (EQ/WAL must not stay green when negative). */
  eqInr: number;
  walInr: number;
  /** Second line: `EQ − WAL` in INR (≈ unrealized in INR when books tie). */
  netInr: number;
  realizedUsdt: number;
  unrealUsdt: number;
  /** Drawdown from session peak equity (≤ 0). */
  ddFromPeakPct: number;
  riskTier: 'SAFE' | 'WARN' | 'HIGH';
  /** USDT/INR rate used for the dual-currency rendering. */
  usdtInrRate: number;
};

export class TuiApp {
  private screen: any;
  /** Host for blessed-contrib grid; sits below ENGINE + two-line portfolio summary. */
  private gridHost: any;
  private grid: any;
  private logPanel: any;
  private topBox: any;
  private statusBar: any;
  /** Full-width portfolio summary (EQ/WAL/UR + NET/REAL/UNREAL/DD/RISK), mirrored inside Balances. */
  private summaryBar: any;
  private headerBox: any;
  private tradeTable: any;
  private positionsTable: any;
  private orderTable: any;
  private balanceTable: any;
  private aiBox: any;
  private signalsBox: any;
  private riskBox: any;
  private helpOverlay: any;
  private recentSignals: Array<{ ts: number; type: string; pair: string; side?: string; conf?: number; reason?: string }> = [];
  private recentRisk: Array<{ ts: number; pair: string; side?: string; rules: string[] }> = [];
  private riskStats = { drawdownPeak: 0, drawdownPct: 0, liveCount: 0 };
  private aiByPair = new Map<string, AiPanelState>();
  private mtfByPair = new Map<string, MtfPanelState>();
  private bookByPair = new Map<string, { asks: string[][]; bids: string[][]; lastPrice: string }>();
  private lastLtpByPair = new Map<string, number>();
  private trendByPair = new Map<string, string>();
  private signalCountsByPair = new Map<string, { long: number; short: number; wait: number; err: number }>();
  private readonly SIGNAL_RING = 30;
  private readonly RISK_RING = 20;

  // ── Asset Focus State ──
  private pairs: string[];
  private focusIndex: number = 0;
  private onFocusChange?: (pair: string) => void;
  private previousActivePairs: Set<string> = new Set();

  // ── TUI Status Flags (Passed from index) ──
  private isConnected: boolean = false;
  private latency: number = 0;
  private lastUpdate: number = 0;
  private bookStateText: string = '—';

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'SMC Alpha Terminal | CoinDCX',
      input: process.stdin,
      output: process.stdout,
      fullUnicode: true,
      keys: true,
      mouse: false,
      // Removed grabKeys: true as it can sometimes interfere with input bubbling in some terminals
    });

    this.pairs = config.pairs;

    this.gridHost = blessed.box({
      parent: this.screen,
      top: 4,
      left: 0,
      width: '100%',
      height: '100%-4',
    });
    this.grid = new contrib.grid({ rows: 13, cols: 12, screen: this.gridHost });

    // Initialize logPanel early so this.log() works
    this.logPanel = this.grid.set(11, 0, 2, 12, blessed.log, {
      label: ' ◉ System Logs ',
      border: { type: 'line', fg: 'gray' },
      scrollable: true,
      tags: true,
      style: { fg: 'gray' },
      scrollbar: { ch: ' ' },
    });

    this.log(`Tui initialized with ${this.pairs.length} pairs: ${this.pairs.join(', ')}`);

    this.topBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 4,
      label: ' ◈ System Status ',
      border: { type: 'line', fg: 'cyan' },
      style: { fg: 'white', border: { fg: 'cyan' } },
    });

    this.statusBar = blessed.box({
      parent: this.topBox,
      top: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      tags: true,
      content: ' LOADING...',
    });

    this.summaryBar = blessed.box({
      parent: this.topBox,
      top: 1,
      left: 0,
      width: '100%-2',
      height: 1,
      tags: true,
      content:
        ' {gray-fg}EQ: — │ WAL: — │ UR: — │ NET: — │ REAL: — │ UNREAL: — │ DD: — │ RISK: —{/gray-fg}',
    });

    // ── Grid row 0: Asset Header (grid is mounted below status + account summary) ──
    this.headerBox = this.grid.set(0, 0, 1, 12, blessed.box, {
      label: ' ◈ Asset Focus ',
      border: { type: 'line', fg: 'cyan' },
      style: { fg: 'white', bold: true },
      tags: true,
      content: this.buildHeaderContent(),
    });

    // ── Grid rows 1–6: Book / AI / Signals (tall enough for ~10 ask + ~10 bid rows + spread) ──
    this.tradeTable = this.grid.set(1, 0, 6, 3, blessed.box, {
      label: ` BOOK · ${this.focusedPairInstrument} `,
      border: { type: 'line', fg: 'blue' },
      style: { fg: 'white' },
      tags: true,
      content: ' {gray-fg}PRICE      AMOUNT      SUM{/gray-fg}',
      scrollable: true
    });

    this.aiBox = this.grid.set(1, 3, 6, 6, blessed.box, {
      label: ` ◈ AI Strategy Pulse — ${this.focusedPairClean} `,
      border: { type: 'line', fg: 'cyan' },
      tags: true,
      content: ' {gray-fg}Analyzing market pulse...{/gray-fg}',
      style: { fg: 'white' }
    });

    // One blessed box per grid cell (no nested child). Nested 100%×100% children overlap the
    // parent's label/border and break line-art; multi-line balance rows need height > 1.
    this.signalsBox = this.grid.set(1, 9, 6, 3, blessed.box, {
      label: ' Signals ',
      border: { type: 'line', fg: 'gray' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ' },
      content: ' {gray-fg}Awaiting strategy signals...{/gray-fg}',
    });

    this.positionsTable = this.grid.set(7, 0, 2, 12, blessed.box, {
      label: ' Active Positions ',
      border: { type: 'line', fg: 'yellow' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ' },
    });

    // Grid rows 8–9: Balances / Orders / Risk (2 grid rows — INR + USD rows need vertical space). Balances 6 cols, Orders/Risk 3 each.
    this.balanceTable = this.grid.set(9, 0, 2, 6, blessed.box, {
      label: ' Balances ',
      border: { type: 'line', fg: 'green' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ' },
    });

    this.orderTable = this.grid.set(9, 6, 2, 3, blessed.box, {
      label: ' Orders ',
      border: { type: 'line', fg: 'magenta' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ' },
    });

    this.riskBox = this.grid.set(9, 9, 2, 3, blessed.box, {
      label: ' Risk ',
      border: { type: 'line', fg: 'gray' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ' },
      content: ' {gray-fg}No risk events yet{/gray-fg}',
    });

    // ── Global Keyboard Handling ──
    this.screen.on('keypress', (ch: string, key: { name?: string; full?: string; shift?: boolean } | undefined) => {
      if (!key) {
        // Handle cases where key is not present but ch is (e.g. some symbols)
        if (ch === '?') { this.toggleHelp(); return; }
        return;
      }

      const keyName = key.name;
      const fullKey = key.full || key.name;

      if (config.LOG_LEVEL === 'debug' && this.logPanel) {
        this.log(`[DEBUG] Key: ${keyName} | Full: ${fullKey} | Ch: ${ch || 'none'}`, 'debug');
      }

      // 1. Exit
      if (keyName === 'q' || fullKey === 'C-c') {
        process.exit(0);
      }

      // 2. Help
      if (keyName === '?' || ch === '?') {
        this.toggleHelp();
        return;
      }

      // 3. Clear Logs
      if (keyName === 'c') {
        if (this.logPanel) this.logPanel.setContent('');
        this.render();
        return;
      }

      // 4. Pair Navigation (Arrow keys, h/l, Tab)
      if (keyName === 'left' || keyName === 'h' || (keyName === 'tab' && key.shift)) {
        this.switchFocus(-1);
        return;
      }
      if (keyName === 'right' || keyName === 'l' || (keyName === 'tab' && !key.shift)) {
        this.switchFocus(1);
        return;
      }

      // 5. Direct Pair Selection (1-9)
      if (keyName && /^[1-9]$/.test(keyName)) {
        const i = parseInt(keyName);
        if (i <= this.pairs.length) {
          const newIdx = i - 1;
          if (this.focusIndex !== newIdx) {
            this.focusIndex = newIdx;
            this.emitFocusChange();
          }
        }
        return;
      }

      // 6. Panel Focus (Shift + key)
      if (fullKey === 'S-s') { this.signalsBox.focus(); this.log('Focus -> Signals'); this.render(); return; }
      if (fullKey === 'S-r') { this.riskBox.focus(); this.log('Focus -> Risk'); this.render(); return; }
      if (fullKey === 'S-p') { this.positionsTable.focus(); this.log('Focus -> Positions'); this.render(); return; }
      if (fullKey === 'S-b') { this.balanceTable.focus(); this.log('Focus -> Balances'); this.render(); return; }
      if (fullKey === 'S-l') { this.logPanel.focus(); this.log('Focus -> Logs'); this.render(); return; }

      // 7. System Keys
      if (fullKey === 'C-l') {
        this.screen.realloc();
        this.render();
        return;
      }

      if (keyName === 'escape') {
        if (!this.helpOverlay.hidden) {
          this.helpOverlay.hide();
        } else {
          // If help is not open, escape can also return focus to logs as a safe default
          this.logPanel.focus();
        }
        this.render();
        return;
      }
    });

    // ── Help overlay (non-focusable, non-clickable to avoid stealing keys) ──
    this.helpOverlay = blessed.box({
      parent: this.screen,
      top: 'center', left: 'center',
      width: '60%', height: '60%',
      border: { type: 'line' },
      label: ' ? Keybindings ',
      tags: true,
      hidden: true,
      keyable: false,
      clickable: false,
      style: { border: { fg: 'cyan' }, fg: 'white', bg: 'black' },
      content: this.buildHelpContent(),
    });

    const modeStr = config.isReadOnly ? 'READ-ONLY' : 'LIVE';
    this.log(`CoinDCX Terminal [${modeStr}] — ${this.pairs.length} pairs loaded`);
    this.log('Controls: ← → / h l / Tab pair, 1-9 direct, ? help, Shift+S/R/P/B/L focus panel, c clear log, q quit, Esc close help');

    this.updateStatus({});
    this.emitFocusChange();

    // Default focus
    this.logPanel.focus();

    // Finalize render
    this.render();
  }

  get focusedPair(): string {
    return this.pairs[this.focusIndex] || this.pairs[0];
  }

  get focusedPairClean(): string {
    return cleanPair(this.focusedPair);
  }

  /** CoinDCX futures instrument for labels (e.g. B-SOL_USDT), not compact SOLUSDT. */
  get focusedPairInstrument(): string {
    return toCoinDcxFuturesInstrument(this.focusedPair);
  }

  setOnFocusChange(callback: (pair: string) => void) {
    this.onFocusChange = callback;
  }

  /**
   * Auto-switch focus to a pair that just acquired an open position.
   * Only switches on transition (pair newly added to active set), so manual
   * navigation is preserved while existing positions remain open.
   */
  notifyActivePositions(activeCleanPairs: string[]): void {
    const newSet = new Set(activeCleanPairs);
    const newlyOpened = activeCleanPairs.filter(p => !this.previousActivePairs.has(p));
    this.previousActivePairs = newSet;
    if (newlyOpened.length === 0) return;

    const focusedClean = this.focusedPairClean;
    if (newSet.has(focusedClean)) return;

    for (const clean of newlyOpened) {
      const idx = this.pairs.findIndex(p => cleanPair(p) === clean);
      if (idx >= 0 && idx !== this.focusIndex) {
        this.focusIndex = idx;
        this.emitFocusChange();
        return;
      }
    }
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

  private buildHeaderContent() {
    const parts = this.pairs.map((pair, i) => {
      const name = cleanPair(pair);
      const c = this.signalCountsByPair.get(pair) ?? { long: 0, short: 0, wait: 0, err: 0 };
      const badges: string[] = [];
      if (c.long > 0) badges.push(`{green-fg}L${c.long}{/green-fg}`);
      if (c.short > 0) badges.push(`{red-fg}S${c.short}{/red-fg}`);
      if (c.err > 0) badges.push(`{red-fg}!${c.err}{/red-fg}`);
      const badgeStr = badges.length ? ` ${badges.join(' ')}` : '';
      if (i === this.focusIndex) {
        return `{cyan-fg}{bold}◉ ${name}{/bold}${badgeStr}{/cyan-fg}`;
      }
      return `{gray-fg}○ ${name}${badgeStr}{/gray-fg}`;
    });
    const selector = parts.join('  │  ');
    return `  ${selector}      {gray-fg}[← →]{/gray-fg}  switch    {gray-fg}[1-${this.pairs.length}]{/gray-fg}  select    {gray-fg}[?]{/gray-fg}  help`;
  }

  private bumpSignalCount(pair: string, side: string | undefined): void {
    if (!pair || pair === '—') return;
    const c = this.signalCountsByPair.get(pair) ?? { long: 0, short: 0, wait: 0, err: 0 };
    if (side === 'LONG') c.long++;
    else if (side === 'SHORT') c.short++;
    else if (side === 'WAIT') c.wait++;
    else if (side === 'ERR') c.err++;
    this.signalCountsByPair.set(pair, c);
  }

  private refreshHeader(): void {
    this.headerBox.setContent(this.buildHeaderContent());
    this.render();
  }

  private renderBookCached(): void {
    const data = this.bookByPair.get(this.focusedPair);
    if (!data) return;
    this.updateOrderBook(data.asks, data.bids, data.lastPrice, this.focusedPair);
  }

  updateStatus(data: Partial<{ connected: boolean; lastUpdate: number }>) {
    if (data.connected !== undefined) this.isConnected = data.connected;
    if (data.lastUpdate !== undefined) this.lastUpdate = data.lastUpdate;

    const wsStatus = this.isConnected ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
    const time = new Date().toLocaleTimeString();

    const modeStr = config.isReadOnly ? '{yellow-fg}MONITOR{/yellow-fg}' : '{green-fg}LIVE{/green-fg}';
    const orderStr = config.isReadOnly ? '{red-fg}OFF{/red-fg}' : '{green-fg}ON{/green-fg}';

    const content = ` {bold}ENGINE: {green-fg}RUN{/green-fg}{/bold}  │  MODE: ${modeStr}  │  ORDER: ${orderStr}  │  WS: ${wsStatus}  │  FEED: {green-fg}OK{/green-fg}  │  FOCUS: ${this.focusedPairClean}  │  TIME: ${time}`;
    this.statusBar.setContent(content);
    this.render();
  }

  updateBookState(s: string): void {
    this.bookStateText = s;
    this.render();
  }

  updateFocus(data: { symbol: string; ltp: string; mark: string; change24h: string }) {
    this.updateHeader({ ltp: data.ltp, mark: data.mark, change: data.change24h });
  }

  private emitFocusChange() {
    this.updateHeader({});
    this.updateStatus({});
    this.tradeTable.setLabel(` BOOK · ${this.focusedPairInstrument} `);
    this.aiBox.setLabel(` ◈ AI Strategy Pulse — ${this.focusedPairClean} `);
    this.renderBookCached();
    this.renderAi();
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
      if (stats.ltp) {
        const currentLtp = parseFloat(stats.ltp);
        const lastLtp = this.lastLtpByPair.get(this.focusedPair);

        if (lastLtp !== undefined && !isNaN(currentLtp) && currentLtp !== lastLtp) {
          const color = currentLtp > lastLtp ? 'green' : 'red';
          const arrow = currentLtp > lastLtp ? '▲' : '▼';
          this.trendByPair.set(this.focusedPair, `{${color}-fg}${arrow}{/${color}-fg}`);
        }

        const trend = this.trendByPair.get(this.focusedPair) || '';
        s.push(`LTP: {white-fg}${stats.ltp}{/white-fg} ${trend}`);
        if (!isNaN(currentLtp)) this.lastLtpByPair.set(this.focusedPair, currentLtp);
      }
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

  log(message: string, level: SystemLogLevel = 'info') {
    // We allow info, warn, and error to be visible to the user
    if (level === 'debug' && config.LOG_LEVEL !== 'debug') return;

    if (this.logPanel) {
      this.logPanel.log(`[${new Date().toLocaleTimeString()}] ${message}`);
    }
  }

  private fusionByPair = new Map<string, any>();

  updateOrderBook(asks: string[][], bids: string[][], lastPrice: string, pair?: string, metrics?: any) {
    const target = pair ?? this.focusedPair;
    this.bookByPair.set(target, { asks, bids, lastPrice });
    if (metrics) this.fusionByPair.set(target, metrics);
    if (target !== this.focusedPair) return;

    if (asks.length === 0 && bids.length === 0) {
      this.tradeTable.setContent(' {gray-fg}Waiting for book data...{/gray-fg}');
      this.render();
      return;
    }

    const fusion = this.fusionByPair.get(target);

    // ── Compute max amount across all visible levels for bar scaling ──
    const parseAmt = (s: string) => parseFloat(s.replace(/,/g, '')) || 0;
    const askSlice = asks.slice(0, Math.min(10, asks.length));
    const bidSlice = bids.slice(0, Math.min(10, bids.length));
    const allAmounts = [
      ...askSlice.map(r => parseAmt(r[1])),
      ...bidSlice.map(r => parseAmt(r[1])),
    ];
    const maxAmt = Math.max(...allAmounts, 1);

    // ── Bar renderer: proportional block bar ──
    const BAR_MAX_WIDTH = 12;
    const renderBar = (amount: number, color: string): string => {
      const ratio = Math.min(amount / maxAmt, 1);
      const fullBlocks = Math.floor(ratio * BAR_MAX_WIDTH);
      const remainder = (ratio * BAR_MAX_WIDTH) - fullBlocks;
      // Unicode fractional blocks: ▏▎▍▌▋▊▉█
      const fractions = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
      const fracChar = fractions[Math.floor(remainder * 8)] || '';
      const bar = '█'.repeat(fullBlocks) + fracChar;
      return `{${color}-fg}${bar}{/${color}-fg}`;
    };

    // ── Header ──
    const header = ` {gray-fg}  ${this.padLeft('PRICE', 10)}${this.padRight('AMOUNT', 12)} DEPTH{/gray-fg}\n`;

    // ── Asks (Red) ──
    const askRows = askSlice.map(row => {
      const priceVal = parseFloat(row[0].replace(/,/g, ''));
      const isWall = fusion?.askWallPrice === priceVal;
      const amt = parseAmt(row[1]);
      const bar = renderBar(amt, 'red');
      const wallMarker = isWall ? '{bold}W{/bold}' : ' ';
      const price = `{red-fg}${this.padLeft(row[0], 10)}{/red-fg}`;
      const amount = this.padRight(row[1], 12);
      return ` {red-fg}A{/red-fg}${wallMarker}${price}${amount} ${bar}`;
    }).reverse();

    // ── Last Price (spread) Row ──
    const currentPrice = parseFloat(lastPrice);
    const prevPrice = this.lastLtpByPair.get(target);

    if (prevPrice !== undefined && !isNaN(currentPrice) && currentPrice !== prevPrice) {
      const color = currentPrice > prevPrice ? 'green' : 'red';
      const arrow = currentPrice > prevPrice ? '▲' : '▼';
      this.trendByPair.set(target, `{${color}-fg}${arrow}{/${color}-fg}`);
    }

    const bestAsk = parseFloat(askSlice[0]?.[0]?.replace(/,/g, '') || '0');
    const bestBid = parseFloat(bidSlice[0]?.[0]?.replace(/,/g, '') || '0');
    const spread = bestAsk > 0 && bestBid > 0 ? (bestAsk - bestBid).toFixed(2) : '—';

    const microImbalance = fusion?.microstructure?.topNImbalance?.imbalance;
    const imb = microImbalance ?? 'neutral';
    const imbColor = imb === 'bid-heavy' ? 'green' : imb === 'ask-heavy' ? 'red' : 'gray';

    const trend = this.trendByPair.get(target) || '';
    // IMB on this line so it stays visible (footer below bids was clipped in the book panel).
    const ltpRow =
      ` {yellow-fg}{bold}${this.padLeft(formatPrice(lastPrice), 12)}{/bold}{/yellow-fg} ${trend}  ` +
      `{gray-fg}SPR:{/gray-fg} {cyan-fg}${spread}{/cyan-fg}  ` +
      `{gray-fg}IMB:{/gray-fg} {${imbColor}-fg}${imb.toUpperCase()}{/${imbColor}-fg}\n`;
    if (!isNaN(currentPrice)) this.lastLtpByPair.set(target, currentPrice);

    // ── Bids (Green) ──
    const bidRows = bidSlice.map(row => {
      const priceVal = parseFloat(row[0].replace(/,/g, ''));
      const isWall = fusion?.bidWallPrice === priceVal;
      const amt = parseAmt(row[1]);
      const bar = renderBar(amt, 'green');
      const wallMarker = isWall ? '{bold}W{/bold}' : ' ';
      const price = `{green-fg}${this.padLeft(row[0], 10)}{/green-fg}`;
      const amount = this.padRight(row[1], 12);
      return ` {green-fg}B{/green-fg}${wallMarker}${price}${amount} ${bar}`;
    });

    this.tradeTable.setContent(header + askRows.join('\n') + '\n' + ltpRow + bidRows.join('\n'));
    this.render();
  }

  updateAi(data: {
    verdict: string;
    signal: string;
    confidence: number;
    no_trade_condition?: string;
    pair?: string;
    entry?: string;
    stopLoss?: string;
    takeProfit?: string;
    rr?: number;
    levels?: string[];
    management?: string;
    currentBias?: string;
    expectedNextBias?: string;
    biasTrigger?: string;
  }) {
    const pair = data.pair ?? this.focusedPair;
    this.aiByPair.set(pair, {
      verdict: data.verdict, signal: data.signal,
      confidence: data.confidence, no_trade_condition: data.no_trade_condition,
      entry: data.entry, stopLoss: data.stopLoss, takeProfit: data.takeProfit, rr: data.rr,
      levels: data.levels, management: data.management,
      currentBias: data.currentBias,
      expectedNextBias: data.expectedNextBias,
      biasTrigger: data.biasTrigger,
    });
    if (pair === this.focusedPair) this.renderAi();
  }

  updateMtf(data: {
    pair: string;
    tf1m?: MtfBar;
    tf15m?: MtfBar;
    tf1h?: MtfBar;
    bookImbalance?: 'bid-heavy' | 'ask-heavy' | 'neutral';
    bestBid?: number;
    bestAsk?: number;
    spread?: number;
  }): void {
    this.mtfByPair.set(data.pair, {
      tf1m: data.tf1m,
      tf15m: data.tf15m,
      tf1h: data.tf1h,
      bookImbalance: data.bookImbalance,
      bestBid: data.bestBid,
      bestAsk: data.bestAsk,
      spread: data.spread,
    });
    if (data.pair === this.focusedPair) this.renderAi();
  }

  private renderAi(): void {
    const data = this.aiByPair.get(this.focusedPair);
    if (!data) {
      this.aiBox.setContent(' {gray-fg}Awaiting analysis...{/gray-fg}');
      this.render();
      return;
    }
    const sig = data.signal || 'WAIT';
    const color = sig === 'LONG' ? 'green' : sig === 'SHORT' ? 'red' : 'yellow';
    const setup =
      sig === 'LONG' || sig === 'SHORT'
        ? [
            ` {white-fg}ENTRY:{/white-fg} ${formatPrice(data.entry)}`,
            ` {white-fg}SL:{/white-fg} ${formatPrice(data.stopLoss)}`,
            ` {white-fg}TP:{/white-fg} ${formatPrice(data.takeProfit)}`,
            data.rr !== undefined && Number.isFinite(data.rr) ? ` {white-fg}R:R:{/white-fg} ${Number(data.rr).toFixed(2)}` : undefined,
          ].filter(Boolean).join('\n')
        : '';
    const reason = data.no_trade_condition && data.no_trade_condition !== 'None' ? `\n {gray-fg}REASON: ${data.no_trade_condition}{/gray-fg}` : '';
    const mgmt = data.management ? `\n\n {yellow-fg}🛡️ MANAGEMENT:{/yellow-fg} {bold}${data.management}{/bold}` : '';
    const levelsStr = Array.isArray(data.levels) && data.levels.length > 0
      ? `\n\n {white-fg}LEVELS TO MONITOR:{/white-fg}\n${data.levels.map((l: string) => ` • ${l}`).join('\n')}`
      : '';
    const mtfSection = this.buildMtfSection(this.focusedPair);
    const biasColor = (b?: string) => {
      const u = (b || '').toUpperCase();
      if (u === 'BULLISH' || u === 'BULL' || u === 'LONG') return 'green';
      if (u === 'BEARISH' || u === 'BEAR' || u === 'SHORT') return 'red';
      return 'yellow';
    };
    const cb = (data.currentBias || '').toUpperCase();
    const nb = (data.expectedNextBias || '').toUpperCase();
    const biasLine = (cb || nb)
      ? `\n {white-fg}BIAS:{/white-fg} {${biasColor(cb)}-fg}${cb || '—'}{/${biasColor(cb)}-fg} {gray-fg}→{/gray-fg} {${biasColor(nb)}-fg}${nb || '—'}{/${biasColor(nb)}-fg}` +
        (data.biasTrigger ? `\n {gray-fg}TRIGGER:{/gray-fg} ${data.biasTrigger}` : '')
      : '';
    const content = `\n {bold}${data.verdict}{/bold}\n\n {${color}-fg}SIGNAL: ${sig}{/${color}-fg}\n {gray-fg}CONF: ${(data.confidence * 100).toFixed(0)}%{/gray-fg}${biasLine}${setup ? `\n${setup}` : ''}${mgmt}${levelsStr}${reason}${mtfSection}`;
    this.aiBox.setContent(content);
    this.render();
  }

  private buildMtfSection(pair: string): string {
    const m = this.mtfByPair.get(pair);
    if (!m) return '';

    const trendChar = (bar?: MtfBar): string => {
      if (!bar) return '{gray-fg}?{/gray-fg}';
      if (bar.trend === 'up')       return '{green-fg}▲{/green-fg}';
      if (bar.trend === 'down')     return '{red-fg}▼{/red-fg}';
      return '{yellow-fg}─{/yellow-fg}';
    };
    const barStr = (label: string, bar?: MtfBar): string => {
      if (!bar) return `{gray-fg}${label}:—{/gray-fg}`;
      const vol = bar.volume >= 1_000_000
        ? `${(bar.volume / 1_000_000).toFixed(1)}M`
        : bar.volume >= 1_000
          ? `${(bar.volume / 1_000).toFixed(1)}K`
          : bar.volume.toFixed(0);
      return `${label}:${trendChar(bar)}{gray-fg}${bar.close.toFixed(2)} v${vol}{/gray-fg}`;
    };

    const bkColor = m.bookImbalance === 'bid-heavy'
      ? 'green'
      : m.bookImbalance === 'ask-heavy'
        ? 'red'
        : 'yellow';
    const bkLabel = m.bookImbalance ?? 'neutral';
    const bkStr = m.bestBid !== undefined
      ? ` {gray-fg}bb{/gray-fg}{green-fg}${m.bestBid.toFixed(2)}{/green-fg} {gray-fg}ba{/gray-fg}{red-fg}${m.bestAsk?.toFixed(2) ?? '—'}{/red-fg} {gray-fg}SPR:{/gray-fg} {cyan-fg}${(m.spread ?? 0).toFixed(2)}{/cyan-fg}`
      : '';

    return `\n\n {gray-fg}─── MTF ───────────────────────────────{/gray-fg}\n ` +
      `${barStr('1m', m.tf1m)}    ${barStr('15m', m.tf15m)}    ${barStr('1h', m.tf1h)}\n ` +
      `{${bkColor}-fg}${bkLabel}{/${bkColor}-fg}${bkStr}`;
  }

  private padLeft(str: string, width: number) {
    const plain = str.replace(/\{[^\}]+\}/g, '');
    const len = plain.length;
    if (len >= width) return str;
    return str + ' '.repeat(width - len);
  }

  private padRight(str: string, width: number) {
    const plain = str.replace(/\{[^\}]+\}/g, '');
    const len = plain.length;
    if (len >= width) return str;
    return ' '.repeat(width - len) + str;
  }

  private stripTags(s: string): string {
    return s.replace(/\{[^}]+\}/g, '');
  }

  /** Short display symbol for signals/risk (e.g. B-ETH_USDT → ETH). */
  private formatSignalSymbol(pair?: string): string {
    if (!pair || pair === '—') return '—';
    const c = cleanPair(pair);
    const base = c.endsWith('USDT') ? c.slice(0, -4) : c;
    return base.slice(0, 10) || '—';
  }

  updatePositions(rows: string[][]) {
    // Widths use plain-text padding so blessed tags do not break alignment.
    const w = { sym: 6, side: 5, qty: 11, px: 11, sl: 6, pnl: 12 };
    const header =
      ` {yellow-fg}${this.padLeft('SYM', w.sym)} ${this.padLeft('SIDE', w.side)} ${this.padRight('QTY', w.qty)} ` +
      `${this.padRight('ENT', w.px)} ${this.padRight('LAST', w.px)} ${this.padRight('MARK', w.px)} ${this.padRight('SL', w.sl)} ${this.padRight('PNL', w.pnl)}{/yellow-fg}\n`;

    const content = rows.map(r => {
      const sidePlain = this.stripTags(r[1] || '');
      const sidePad = this.padLeft(sidePlain, w.side);
      const sideCol =
        sidePlain === 'LONG'
          ? `{green-fg}${sidePad}{/green-fg}`
          : sidePlain === 'SHORT'
            ? `{red-fg}${sidePad}{/red-fg}`
            : sidePad;

      const pnlPlain = this.stripTags(r[7] || '');
      const pnlVal = parseFloat(pnlPlain.replace(/[^0-9.+-Ee]/g, '')) || 0;
      const pnlColor = pnlVal > 0 ? 'green' : pnlVal < 0 ? 'red' : 'white';
      const pnlPadded = this.padRight(pnlPlain, w.pnl);

      return (
        ` ${this.padLeft(this.stripTags(r[0] || ''), w.sym)} ${sideCol} ${this.padRight(this.stripTags(r[2] || ''), w.qty)} ` +
        `${this.padRight(this.stripTags(r[3] || ''), w.px)} ${this.padRight(this.stripTags(r[4] || ''), w.px)} ` +
        `${this.padRight(this.stripTags(r[5] || ''), w.px)} ${this.padRight(this.stripTags(r[6] || ''), w.sl)} ` +
        `{${pnlColor}-fg}${pnlPadded}{/${pnlColor}-fg}`
      );
    }).join('\n');

    this.positionsTable.setContent(header + content);
    this.render();
  }

  /** NET │ REAL USDT │ UNREAL USDT │ DD │ RISK (second summary line). */
  private formatBalanceDetailLine(d: BalancePanelTotals): string {
    const netC = d.netInr > 0 ? 'green' : d.netInr < 0 ? 'red' : 'gray';
    const realC = d.realizedUsdt > 0 ? 'green' : d.realizedUsdt < 0 ? 'red' : 'gray';
    const unrealC = d.unrealUsdt > 0 ? 'green' : d.unrealUsdt < 0 ? 'red' : 'gray';
    const ddC = d.ddFromPeakPct <= -12 ? 'red' : d.ddFromPeakPct <= -5 ? 'yellow' : 'green';
    const riskC = d.riskTier === 'HIGH' ? 'red' : d.riskTier === 'WARN' ? 'yellow' : 'green';
    const ddStr = `${d.ddFromPeakPct.toFixed(2)}%`;
    return (
      ` {bold}NET:{/bold} {${netC}-fg}₹${formatQty(d.netInr)}{/${netC}-fg}  {gray-fg}│{/gray-fg}  ` +
      `{bold}REAL USDT:{/bold} {${realC}-fg}${d.realizedUsdt.toFixed(2)}{/${realC}-fg}  {gray-fg}│{/gray-fg}  ` +
      `{bold}UNREAL USDT:{/bold} {${unrealC}-fg}${d.unrealUsdt.toFixed(2)}{/${unrealC}-fg}  {gray-fg}│{/gray-fg}  ` +
      `{bold}DD:{/bold} {${ddC}-fg}${ddStr}{/${ddC}-fg}  {gray-fg}│{/gray-fg}  ` +
      `{bold}RISK:{/bold} {${riskC}-fg}${d.riskTier}{/${riskC}-fg}`
    );
  }

  /** Combined EQ │ WAL │ UR │ NET │ REAL │ UNREAL │ DD │ RISK on a single line. */
  private formatBalancePortfolioOneLine(d: BalancePanelTotals): string {
    const eqC = d.eqInr > 0 ? 'green' : d.eqInr < 0 ? 'red' : 'cyan';
    const walC = d.walInr > 0 ? 'green' : d.walInr < 0 ? 'red' : 'gray';
    const urC = d.urInr > 0 ? 'green' : d.urInr < 0 ? 'red' : 'cyan';
    const realC = d.realizedUsdt > 0 ? 'green' : d.realizedUsdt < 0 ? 'red' : 'gray';
    const ddC = d.ddFromPeakPct <= -12 ? 'red' : d.ddFromPeakPct <= -5 ? 'yellow' : 'green';
    const riskC = d.riskTier === 'HIGH' ? 'red' : d.riskTier === 'WARN' ? 'yellow' : 'green';
    const walHasTags = d.wallet.includes('{');
    const walSeg = walHasTags ? d.wallet : `{${walC}-fg}${d.wallet}{/${walC}-fg}`;
    const sep = `  {gray-fg}│{/gray-fg}  `;
    const r = d.usdtInrRate > 0 ? d.usdtInrRate : 88;
    const realStr = `$${d.realizedUsdt.toFixed(2)} (₹${formatQty(d.realizedUsdt * r, 2)})`;
    return (
      ` {bold}EQ:{/bold} {${eqC}-fg}${d.equity}{/${eqC}-fg}${sep}` +
      `{bold}WAL:{/bold} ${walSeg}${sep}` +
      `{bold}UR:{/bold} {${urC}-fg}${d.ur}{/${urC}-fg}${sep}` +
      `{bold}REAL:{/bold} {${realC}-fg}${realStr}{/${realC}-fg}${sep}` +
      `{bold}DD:{/bold} {${ddC}-fg}${d.ddFromPeakPct.toFixed(2)}%{/${ddC}-fg}${sep}` +
      `{bold}RISK:{/bold} {${riskC}-fg}${d.riskTier}{/${riskC}-fg}`
    );
  }

  /** Single-line EQ │ WAL │ UR (for top summary bar and as first line inside Balances). */
  private formatBalancePortfolioLine(data: BalancePanelTotals): string {
    const urColor = data.urInr > 0 ? 'green' : data.urInr < 0 ? 'red' : 'cyan';
    const eqColor = data.eqInr > 0 ? 'green' : data.eqInr < 0 ? 'red' : 'cyan';
    const walHasBlessedTags = data.wallet.includes('{');
    const walColor =
      data.walInr > 0 ? 'green' : data.walInr < 0 ? 'red' : 'gray';
    const walletSegment = walHasBlessedTags
      ? data.wallet
      : `{${walColor}-fg}${data.wallet}{/${walColor}-fg}`;
    return (
      ` {bold}EQ:{/bold} {${eqColor}-fg}${data.equity}{/${eqColor}-fg}  {gray-fg}│{/gray-fg}  ` +
      `{bold}WAL:{/bold} ${walletSegment}  {gray-fg}│{/gray-fg}  ` +
      `{bold}UR:{/bold} {${urColor}-fg}${data.ur}{/${urColor}-fg}`
    );
  }

  /** Portfolio header inside the Balances panel: one-line figures + separator under the label. */
  private formatBalancePortfolioStrip(data: BalancePanelTotals): string {
    return (
      `${this.formatBalancePortfolioLine(data)}\n` +
      `${this.formatBalanceDetailLine(data)}\n` +
      ` {gray-fg}${'─'.repeat(76)}{/gray-fg}\n`
    );
  }

  updateBalances(rows: string[][], totals?: BalancePanelTotals) {
    const c = { asset: 10, num: 12, pct: 8, util: 9 };
    if (totals) {
      this.summaryBar.setContent(this.formatBalancePortfolioOneLine(totals));
    } else {
      this.summaryBar.setContent(
        ' {gray-fg}EQ: — │ WAL: — │ UR: — │ NET: — │ REAL: — │ UNREAL: — │ DD: — │ RISK: —{/gray-fg}',
      );
    }
    // Portfolio summary lives in the top summaryBar — do not duplicate inside Balances panel.
    const portfolio = '';
    const header =
      ` {green-fg}${this.padLeft('ASSET', c.asset)} ${this.padRight('VALUE', c.num)} ${this.padRight('WALLET', c.num)} ` +
      `${this.padRight('PNL', c.num)} ${this.padRight('%', c.pct)} ${this.padRight('AVAIL', c.num)} ${this.padRight('LOCK', c.num)} ${this.padRight('UTIL%', c.util)}{/green-fg}\n`;

    const content = rows.map(r => {
      const assetPlain = this.stripTags(r[0] || '');
      const isUsdVirtual = assetPlain.includes('USD') && assetPlain.includes('$');
      const padNum = (raw: string | undefined, wrapCyan: boolean) => {
        const p = this.padRight(this.stripTags(raw || ''), c.num);
        return wrapCyan ? `{cyan-fg}${p}{/cyan-fg}` : p;
      };

      const pnlPlain = this.stripTags(r[3] || '');
      const pnlValue = parseFloat(pnlPlain.replace(/[^0-9.+-Ee]/g, '')) || 0;
      const pnlColor = pnlValue > 0 ? 'green' : pnlValue < 0 ? 'red' : 'white';
      const pnlPadded = this.padRight(pnlPlain, c.num);

      const pctPlain = this.stripTags(r[4] || '');
      const pctVal = parseFloat(pctPlain.replace(/[^0-9.+-Ee]/g, '')) || 0;
      const pctPad = this.padRight(pctPlain, c.pct);
      const pctCol = !pctPlain.includes('%')
        ? pctPad
        : pctVal < 0
          ? `{red-fg}${pctPad}{/red-fg}`
          : pctVal > 0
            ? `{green-fg}${pctPad}{/green-fg}`
            : `{gray-fg}${pctPad}{/gray-fg}`;

      const utilPlain = this.stripTags(r[7] || '');
      const utilPad = this.padRight(utilPlain, c.util);
      const utilCol = utilPlain.includes('%') ? `{yellow-fg}${utilPad}{/yellow-fg}` : utilPad;

      const assetPad = this.padLeft(assetPlain, c.asset);
      const assetCol = isUsdVirtual ? `{cyan-fg}${assetPad}{/cyan-fg}` : assetPad;

      return (
        ` ${assetCol} ${padNum(r[1], isUsdVirtual)} ${padNum(r[2], isUsdVirtual)} ` +
        `{${pnlColor}-fg}${pnlPadded}{/${pnlColor}-fg} ${pctCol} ${padNum(r[5], isUsdVirtual)} ${padNum(r[6], isUsdVirtual)} ${utilCol}`
      );
    }).join('\n');

    this.balanceTable.setContent(portfolio + header + content);
    this.render();
  }

  updateOrders(rows: string[][]) {
    const o = { side: 4, pair: 12, st: 10, lat: 8 };
    const header =
      ` {magenta-fg}${this.padLeft('SIDE', o.side)} ${this.padLeft('PAIR', o.pair)} ${this.padLeft('STATUS', o.st)} ${this.padRight('LAT', o.lat)}{/magenta-fg}\n`;

    const isPlaceholderRow =
      rows.length > 0 &&
      rows.length === 1 &&
      rows[0].every((c) => !c || c === '—' || c === 'Connecting...');

    if (isPlaceholderRow) {
      const rowW = o.side + o.pair + o.st + o.lat + 3;
      const msg =
        rows[0][1] === 'Connecting...'
          ? ` ${this.padLeft('', o.side)} {gray-fg}${this.padLeft('Connecting…', rowW)}{/gray-fg}`
          : ` ${this.padLeft('', o.side)} {gray-fg}${this.padLeft('No open orders', rowW)}{/gray-fg}`;
      this.orderTable.setContent(header + msg);
      this.render();
      return;
    }

    const content = rows.map(r => {
      const sidePlain = this.stripTags(r[0] || '');
      const sidePad = this.padLeft(sidePlain, o.side);
      const sideCol =
        sidePlain === 'B' || sidePlain.toLowerCase() === 'buy'
          ? `{green-fg}${sidePad}{/green-fg}`
          : sidePlain === 'S' || sidePlain.toLowerCase() === 'sell'
            ? `{red-fg}${sidePad}{/red-fg}`
            : this.padLeft(sidePlain, o.side);
      return ` ${sideCol} ${this.padLeft(this.stripTags(r[1] || ''), o.pair)} ${this.padLeft(this.stripTags(r[2] || ''), o.st)} ${this.padRight(this.stripTags(r[3] || ''), o.lat)}`;
    }).join('\n');

    this.orderTable.setContent(header + content);
    this.render();
  }

  // ══════════════════════════════════════════════════════
  // ── F6: Signals + Risk panels + bus observer ──
  // ══════════════════════════════════════════════════════

  observeSignal(signal: { strategy?: string; type: string; pair?: string; payload?: any; ts?: string }): void {
    const ts = signal.ts ? new Date(signal.ts).getTime() : Date.now();
    const type = signal.type ?? 'unknown';
    const pair = signal.pair ?? '—';

    if (type.startsWith('strategy.') && type !== 'strategy.error' && type !== 'strategy.disabled') {
      const side = type.split('.')[1]?.toUpperCase();
      const conf = Number(signal.payload?.confidence ?? 0);
      const reason = String(signal.payload?.reason ?? '').slice(0, 30);
      if (signal.strategy === 'llm.pulse.v1') {
        this.updateAi({
          verdict: String(signal.payload?.reason ?? ''),
          signal: side ?? 'WAIT',
          confidence: conf,
          no_trade_condition: signal.payload?.noTradeCondition ? String(signal.payload.noTradeCondition) : undefined,
          entry: signal.payload?.entry ? String(signal.payload.entry) : undefined,
          stopLoss: signal.payload?.stopLoss ? String(signal.payload.stopLoss) : undefined,
          takeProfit: signal.payload?.takeProfit ? String(signal.payload.takeProfit) : undefined,
          rr: typeof signal.payload?.meta?.rr === 'number' ? signal.payload.meta.rr : undefined,
          management: signal.payload?.management ? String(signal.payload.management) : undefined,
          pair,
        });
      }
      if (side !== 'WAIT') {
        this.recentSignals.unshift({ ts, type, pair, side, conf, reason });
        this.recentSignals = this.recentSignals.slice(0, this.SIGNAL_RING);
        this.renderSignals();
      }
      this.bumpSignalCount(pair, side);
      this.refreshHeader();
      return;
    }

    if (type === 'strategy.error' || type === 'strategy.disabled') {
      if (signal.strategy === 'llm.pulse.v1') {
        const err = String(signal.payload?.error ?? signal.payload?.reason ?? 'analysis failed');
        this.updateAi({
          verdict: `AI analysis unavailable: ${err}`,
          signal: 'WAIT',
          confidence: 0,
          no_trade_condition: err,
          pair,
        });
      }
      this.recentSignals.unshift({ ts, type, pair, reason: String(signal.payload?.error ?? signal.payload?.reason ?? '').slice(0, 30) });
      this.recentSignals = this.recentSignals.slice(0, this.SIGNAL_RING);
      this.bumpSignalCount(pair, 'ERR');
      this.renderSignals();
      this.refreshHeader();
      return;
    }

    if (type === 'risk.blocked') {
      const rules = Array.isArray(signal.payload?.rules) ? signal.payload.rules.map((r: any) => r.id) : [];
      const side = String(signal.payload?.side ?? '');
      this.recentRisk.unshift({ ts, pair, side, rules });
      this.recentRisk = this.recentRisk.slice(0, this.RISK_RING);
      this.renderRisk();
    }
  }

  updateRiskStats(stats: Partial<{ drawdownPeak: number; drawdownPct: number; liveCount: number }>): void {
    if (stats.drawdownPeak !== undefined) this.riskStats.drawdownPeak = stats.drawdownPeak;
    if (stats.drawdownPct !== undefined) this.riskStats.drawdownPct = stats.drawdownPct;
    if (stats.liveCount !== undefined) this.riskStats.liveCount = stats.liveCount;
    this.renderRisk();
  }

  private renderSignals(): void {
    if (this.recentSignals.length === 0) {
      this.signalsBox.setContent(' {gray-fg}Awaiting strategy signals...{/gray-fg}');
      this.render();
      return;
    }
    const lines = this.recentSignals.map(s => {
      const t = new Date(s.ts).toLocaleTimeString();
      const sym = this.formatSignalSymbol(s.pair);
      if (s.type === 'strategy.error') {
        return ` {red-fg}${t}{/red-fg} {red-fg}ERR{/red-fg} ${sym} ${s.reason ?? ''}`;
      }
      if (s.type === 'strategy.disabled') {
        return ` {red-fg}${t}{/red-fg} {red-fg}DIS{/red-fg} ${sym}`;
      }
      const color = s.side === 'LONG' ? 'green' : s.side === 'SHORT' ? 'red' : 'yellow';
      const tag = (s.side ?? '?').slice(0, 4).padEnd(4);
      const conf = `${((s.conf ?? 0) * 100).toFixed(0)}%`.padStart(4);
      return ` {gray-fg}${t}{/gray-fg} {${color}-fg}${tag}{/${color}-fg} ${this.padRight(sym, 10)} ${conf}`;
    });
    this.signalsBox.setContent(lines.join('\n'));
    this.render();
  }

  private renderRisk(): void {
    const stats = this.riskStats;
    const ddPct = (stats.drawdownPct * 100).toFixed(2);
    const ddColor = stats.drawdownPct > 0.05 ? 'red' : stats.drawdownPct > 0.02 ? 'yellow' : 'green';
    const header = ` {bold}Live: ${stats.liveCount}{/bold}  DD: {${ddColor}-fg}${ddPct}%{/${ddColor}-fg}  Peak: ${stats.drawdownPeak.toFixed(0)}\n {gray-fg}─────────────────────────{/gray-fg}\n`;
    if (this.recentRisk.length === 0) {
      this.riskBox.setContent(header + ' {gray-fg}No risk events{/gray-fg}');
      this.render();
      return;
    }
    const lines = this.recentRisk.map(r => {
      const t = new Date(r.ts).toLocaleTimeString();
      const sym = this.formatSignalSymbol(r.pair);
      const sideTag = r.side === 'LONG' ? '{green-fg}L{/green-fg}' : r.side === 'SHORT' ? '{red-fg}S{/red-fg}' : '?';
      const ruleTag = (r.rules[0] ?? 'risk').slice(0, 16);
      return ` {gray-fg}${t}{/gray-fg} ${sideTag} ${this.padRight(sym, 10)} {yellow-fg}${ruleTag}{/yellow-fg}`;
    });
    this.riskBox.setContent(header + lines.join('\n'));
    this.render();
  }

  private toggleHelp(): void {
    if (this.helpOverlay.hidden) {
      this.helpOverlay.show();
      this.helpOverlay.setFront();
    } else {
      this.helpOverlay.hide();
    }
    this.render();
  }

  private buildHelpContent(): string {
    return `\n {bold}Pair navigation{/bold}\n` +
      `   ←/h, →/l, Tab    switch pair\n` +
      `   1-9              direct select pair by index\n\n` +
      ` {bold}Panel focus (Shift + key){/bold}\n` +
      `   Shift+P          positions table\n` +
      `   Shift+B          balances (EQ/WAL/UR + NET/REAL/UNREAL/DD/RISK under ENGINE)\n` +
      `   Shift+S          signals\n` +
      `   Shift+R          risk\n` +
      `   Shift+L          system log\n\n` +
      ` {bold}Misc{/bold}\n` +
      `   c                clear log panel\n` +
      `   ?                toggle this help\n` +
      `   Esc              close help overlay\n` +
      `   Ctrl-L           re-allocate screen\n` +
      `   q / Ctrl-C       quit\n\n` +
      ` {gray-fg}Press ? again to close{/gray-fg}`;
  }
}
