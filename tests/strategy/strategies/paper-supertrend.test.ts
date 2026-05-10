import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Candle } from '../../../src/ai/state-builder';
import type { StrategyContext } from '../../../src/strategy/types';
import { computeSupertrend } from '../../../src/marketdata/indicators/supertrend';
import { PaperSupertrendStrategy } from '../../../src/strategy/strategies/paper-supertrend';
import type { PaperSupertrendPosition } from '../../../src/persistence/paper-supertrend-repository';

vi.mock('../../../src/marketdata/indicators/supertrend', () => ({
  computeSupertrend: vi.fn(),
}));

const mockedSt = vi.mocked(computeSupertrend);

function mkCandle(close: number, i: number): Candle {
  return {
    timestamp: 1_700_000_000_000 + i * 900_000,
    open: close - 0.05,
    high: close + 0.1,
    low: close - 0.1,
    close,
    volume: 1,
  };
}

function mkCandles(n: number, close: number): Candle[] {
  return Array.from({ length: n }, (_, i) => mkCandle(close + i * 0.01, i));
}

function baseCtx(fusion: Partial<StrategyContext['fusion']> = {}): StrategyContext {
  const candles = mkCandles(40, 100);
  return {
    ts: 1_700_000_000_000,
    pair: 'B-ETH_USDT',
    trigger: { kind: 'bar_close', tf: '15m' },
    marketState: { symbol: 'ETH', current_price: 100 } as StrategyContext['marketState'],
    account: {} as StrategyContext['account'],
    recentFills: [],
    fusion: {
      candles: { '15m': candles },
      ltp: { price: 100 },
      ...fusion,
    } as StrategyContext['fusion'],
  } as StrategyContext;
}

function deps(overrides: Partial<ConstructorParameters<typeof PaperSupertrendStrategy>[0]> = {}) {
  const repo = {
    findOpen: vi.fn(),
    createOpen: vi.fn(),
    appendLeg: vi.fn(),
    updateMark: vi.fn(),
    closeTp: vi.fn(),
    _resetMarkThrottleForTests: vi.fn(),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: () => ({ error: vi.fn() }) };
  return {
    repo: repo as any,
    logger: logger as any,
    PAPER_SUPERTREND_PAIRS: ['B-ETH_USDT', 'B-SOL_USDT'] as const,
    PAPER_SUPERTREND_CAPITAL_USDT: 1000,
    PAPER_SUPERTREND_LEG_PCT: 50,
    PAPER_SUPERTREND_INITIAL_TP_PCT: 5,
    PAPER_SUPERTREND_ADD_TP_PCT: 10,
    PAPER_SUPERTREND_DD_TRIGGER_PCT: 10,
    PAPER_SUPERTREND_MAX_LEGS: 4,
    PAPER_SUPERTREND_ST_LENGTH: 14,
    PAPER_SUPERTREND_ST_MULTIPLIER: 2,
    PAPER_SUPERTREND_TF: '15m',
    ...overrides,
  };
}

describe('PaperSupertrendStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits entry on ST flip and persists open position', async () => {
    mockedSt.mockReturnValue({ direction: 'up', flipped: true, value: 99, atr: 1 });
    const d = deps();
    d.repo.findOpen.mockResolvedValue(null);
    d.repo.createOpen.mockResolvedValue({
      id: '1',
      pair: 'B-ETH_USDT',
      side: 'LONG',
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      capitalUsdt: 1000,
      legs: [],
      avgEntry: 100,
      totalNotionalUsdt: 500,
      tpPrice: 105,
      tpPct: 5,
      realizedPnlUsdt: null,
      realizedPnlPct: null,
      lastMarkPrice: null,
      lastMarkPnlPct: null,
      lastMarkAt: null,
      metadata: {},
    });
    const strat = new PaperSupertrendStrategy(d);
    const sig = await strat.evaluate(baseCtx({ ltp: { price: 100 } } as any));
    expect(sig?.directEmit?.type).toBe('paper.supertrend.entry');
    expect(d.repo.createOpen).toHaveBeenCalledTimes(1);
  });

  it('returns null when no flip and no open position', async () => {
    mockedSt.mockReturnValue({ direction: 'up', flipped: false, value: 99, atr: 1 });
    const d = deps();
    d.repo.findOpen.mockResolvedValue(null);
    const strat = new PaperSupertrendStrategy(d);
    const sig = await strat.evaluate(baseCtx());
    expect(sig).toBeNull();
    expect(d.repo.createOpen).not.toHaveBeenCalled();
  });

  it('emits TP and closes when mark crosses TP price', async () => {
    mockedSt.mockReturnValue({ direction: 'up', flipped: false, value: 99, atr: 1 });
    const d = deps();
    const openPos: PaperSupertrendPosition = {
      id: '10',
      pair: 'B-ETH_USDT',
      side: 'LONG',
      status: 'open',
      openedAt: new Date(1_699_900_000_000).toISOString(),
      closedAt: null,
      capitalUsdt: 1000,
      legs: [{ ts: new Date(1_699_900_000_000).toISOString(), price: 100, notionalUsdt: 500, qty: 5 }],
      avgEntry: 100,
      totalNotionalUsdt: 500,
      tpPrice: 105,
      tpPct: 5,
      realizedPnlUsdt: null,
      realizedPnlPct: null,
      lastMarkPrice: null,
      lastMarkPnlPct: null,
      lastMarkAt: null,
      metadata: {},
    };
    d.repo.findOpen.mockResolvedValue(openPos);
    const strat = new PaperSupertrendStrategy(d);
    const sig = await strat.evaluate(baseCtx({ ltp: { price: 106 } } as any));
    expect(sig?.directEmit?.type).toBe('paper.supertrend.tp');
    expect(d.repo.closeTp).toHaveBeenCalledTimes(1);
  });

  it('emits add on -10% drawdown and appends leg', async () => {
    mockedSt.mockReturnValue({ direction: 'up', flipped: false, value: 90, atr: 1 });
    const d = deps();
    const openPos: PaperSupertrendPosition = {
      id: '11',
      pair: 'B-ETH_USDT',
      side: 'LONG',
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      capitalUsdt: 1000,
      legs: [{ ts: new Date().toISOString(), price: 100, notionalUsdt: 500, qty: 5 }],
      avgEntry: 100,
      totalNotionalUsdt: 500,
      tpPrice: 105,
      tpPct: 5,
      realizedPnlUsdt: null,
      realizedPnlPct: null,
      lastMarkPrice: null,
      lastMarkPnlPct: null,
      lastMarkAt: null,
      metadata: {},
    };
    d.repo.findOpen.mockResolvedValue(openPos);
    const strat = new PaperSupertrendStrategy(d);
    const sig = await strat.evaluate(baseCtx({ ltp: { price: 89 } } as any));
    expect(sig?.directEmit?.type).toBe('paper.supertrend.add');
    expect(d.repo.appendLeg).toHaveBeenCalledTimes(1);
  });

  it('emits warn once when max legs and still at drawdown trigger', async () => {
    mockedSt.mockReturnValue({ direction: 'up', flipped: false, value: 88, atr: 1 });
    const d = deps();
    const legs = [1, 2, 3, 4].map((k) => ({
      ts: new Date().toISOString(),
      price: 100 - k,
      notionalUsdt: 250,
      qty: 2.5,
    }));
    const openPos: PaperSupertrendPosition = {
      id: '12',
      pair: 'B-ETH_USDT',
      side: 'LONG',
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      capitalUsdt: 1000,
      legs,
      avgEntry: 97,
      totalNotionalUsdt: 1000,
      tpPrice: 110,
      tpPct: 10,
      realizedPnlUsdt: null,
      realizedPnlPct: null,
      lastMarkPrice: null,
      lastMarkPnlPct: null,
      lastMarkAt: null,
      metadata: {},
    };
    d.repo.findOpen.mockResolvedValue(openPos);
    const strat = new PaperSupertrendStrategy(d);
    const ctx = baseCtx({ ltp: { price: 85 } } as any);
    const w1 = await strat.evaluate(ctx);
    expect(w1?.directEmit?.type).toBe('paper.supertrend.warn');
    const w2 = await strat.evaluate(ctx);
    expect(w2).toBeNull();
  });

  it('emits flip_ignored when ST flips against open side', async () => {
    mockedSt.mockReturnValue({ direction: 'down', flipped: true, value: 102, atr: 1 });
    const d = deps();
    const openPos: PaperSupertrendPosition = {
      id: '13',
      pair: 'B-ETH_USDT',
      side: 'LONG',
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      capitalUsdt: 1000,
      legs: [{ ts: new Date().toISOString(), price: 100, notionalUsdt: 500, qty: 5 }],
      avgEntry: 100,
      totalNotionalUsdt: 500,
      tpPrice: 105,
      tpPct: 5,
      realizedPnlUsdt: null,
      realizedPnlPct: null,
      lastMarkPrice: null,
      lastMarkPnlPct: null,
      lastMarkAt: null,
      metadata: {},
    };
    d.repo.findOpen.mockResolvedValue(openPos);
    const strat = new PaperSupertrendStrategy(d);
    const sig = await strat.evaluate(baseCtx({ ltp: { price: 99 } } as any));
    expect(sig?.directEmit?.type).toBe('paper.supertrend.flip_ignored');
  });

  it('emits capital warn when add blocked by remaining capital', async () => {
    mockedSt.mockReturnValue({ direction: 'up', flipped: false, value: 90, atr: 1 });
    const d = deps();
    const legs = [
      { ts: new Date().toISOString(), price: 100, notionalUsdt: 475, qty: 4.75 },
      { ts: new Date().toISOString(), price: 100, notionalUsdt: 475, qty: 4.75 },
    ];
    const openPos: PaperSupertrendPosition = {
      id: '14',
      pair: 'B-ETH_USDT',
      side: 'LONG',
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      capitalUsdt: 1000,
      legs,
      avgEntry: 100,
      totalNotionalUsdt: 950,
      tpPrice: 110,
      tpPct: 10,
      realizedPnlUsdt: null,
      realizedPnlPct: null,
      lastMarkPrice: null,
      lastMarkPnlPct: null,
      lastMarkAt: null,
      metadata: {},
    };
    d.repo.findOpen.mockResolvedValue(openPos);
    const strat = new PaperSupertrendStrategy(d);
    const sig = await strat.evaluate(baseCtx({ ltp: { price: 88 } } as any));
    expect(sig?.directEmit?.type).toBe('paper.supertrend.warn');
    expect((sig?.meta as any)?.warnKind).toBe('capital');
    expect(d.repo.appendLeg).not.toHaveBeenCalled();
  });
});
