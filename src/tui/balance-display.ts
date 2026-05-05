import type { Balance, Position } from '../account/types';
import { cleanPair } from '../utils/format';

export interface TickerLite {
  price?: string;
}

/** CoinDCX futures: wallet cash + margin locked in that currency (REST + WS). */
export function walletTotal(b: Pick<Balance, 'available' | 'locked'>): number {
  const a = parseFloat(b.available || '0');
  const l = parseFloat(b.locked || '0');
  const t = a + l;
  return Number.isFinite(t) ? t : 0;
}

/**
 * When REST (`balanceMap`) and reconciler snapshot disagree, prefer the row with
 * larger total wallet so a transient WS zero does not wipe a good REST fetch.
 */
export function mergeBalanceRowsForDisplay(
  fromBalanceMap: Map<string, { balance: string; locked: string }>,
  snapshotBalances: Balance[],
  nowIso: string,
): Balance[] {
  const fromMap = new Map<string, Balance>();
  for (const [currency, v] of fromBalanceMap) {
    const key = currency.toUpperCase();
    fromMap.set(key, {
      currency,
      available: v.balance,
      locked: v.locked,
      updatedAt: nowIso,
      source: 'rest',
    });
  }

  const fromSnap = new Map<string, Balance>();
  for (const b of snapshotBalances) {
    fromSnap.set(b.currency.toUpperCase(), b);
  }

  const keys = new Set([...fromMap.keys(), ...fromSnap.keys()]);
  const out: Balance[] = [];

  for (const key of keys) {
    const a = fromMap.get(key);
    const s = fromSnap.get(key);
    if (!a && !s) continue;
    if (!a) {
      out.push(s!);
      continue;
    }
    if (!s) {
      out.push(a);
      continue;
    }
    const wa = walletTotal(a);
    const ws = walletTotal(s);
    if (ws > wa + 1e-12) out.push(s);
    else if (wa > ws + 1e-12) out.push(a);
    else out.push(s);
  }

  const rank = (c: string) => {
    const u = c.toUpperCase();
    if (u === 'INR' || u === 'USDTINR') return 0;
    if (u === 'USDT' || u === 'USD') return 1;
    return 2;
  };
  out.sort((x, y) => rank(x.currency) - rank(y.currency) || x.currency.localeCompare(y.currency));
  return out;
}

export function unrealizedPnlNumber(
  p: Position,
  tickers: Map<string, TickerLite>,
): number {
  const clean = cleanPair(p.pair || '');
  const ticker = tickers.get(clean);
  const qty = Math.abs(parseFloat(p.activePos || '0'));
  if (qty === 0) return 0;

  const hasLivePrice = Boolean(ticker?.price && parseFloat(ticker.price) > 0);
  if (hasLivePrice) {
    const currentPrice = parseFloat(ticker!.price!);
    const entryPrice = parseFloat(p.avgPrice || '0');
    const isLong = parseFloat(p.activePos || '0') > 0;
    return isLong
      ? (currentPrice - entryPrice) * qty
      : (entryPrice - currentPrice) * qty;
  }

  const fromEx = parseFloat(p.unrealizedPnl || '0');
  return Number.isFinite(fromEx) ? fromEx : 0;
}

/** Sum `realizedPnl` for USDT-quoted pairs (same quote rule as unrealized buckets). */
export function sumRealizedPnlUsdt(positions: Position[]): number {
  let sum = 0;
  for (const p of positions) {
    if (quoteBucketForPosition(p.pair) !== 'USDT') continue;
    const r = parseFloat(p.realizedPnl || '0');
    if (Number.isFinite(r)) sum += r;
  }
  return sum;
}

/** Portfolio risk label from peak drawdown % and optional cross margin ratio. */
export function classifyPortfolioRisk(
  ddFromPeakPct: number,
  marginRatioCross?: number | null,
): 'SAFE' | 'WARN' | 'HIGH' {
  const mr =
    marginRatioCross != null && Number.isFinite(marginRatioCross) ? marginRatioCross : null;
  if (mr != null && mr >= 0.85) return 'HIGH';
  if (mr != null && mr >= 0.5) return 'WARN';
  if (ddFromPeakPct <= -12) return 'HIGH';
  if (ddFromPeakPct <= -5) return 'WARN';
  return 'SAFE';
}

/**
 * Quote currency for a futures pair (`*_USDT` vs `*_INR`). Used for PnL buckets so
 * USDT-sized UR is not shown under the ₹ row when `margin_currency_short_name` is INR.
 */
export function quoteBucketForPosition(pair: string): 'INR' | 'USDT' {
  const u = (pair || '').toUpperCase().replace(/^B-/, '');
  if (u.includes('_INR') || u.endsWith('INR')) return 'INR';
  return 'USDT';
}

export function marginPnlBuckets(
  positions: Position[],
  tickers: Map<string, TickerLite>,
): { pnlInrMargin: number; pnlUsdtMargin: number } {
  let pnlInrMargin = 0;
  let pnlUsdtMargin = 0;

  for (const p of positions) {
    const u = unrealizedPnlNumber(p, tickers);
    const bucket = quoteBucketForPosition(p.pair || '');
    if (bucket === 'INR') pnlInrMargin += u;
    else pnlUsdtMargin += u;
  }

  return { pnlInrMargin, pnlUsdtMargin };
}

export function portfolioUnrealizedInrUsdt(
  buckets: { pnlInrMargin: number; pnlUsdtMargin: number },
  usdtInrRate: number,
): { totalPnlInr: number; totalPnlUsdt: number } {
  const r = usdtInrRate > 0 ? usdtInrRate : 88;
  const totalPnlInr = buckets.pnlInrMargin + buckets.pnlUsdtMargin * r;
  const totalPnlUsdt = buckets.pnlUsdtMargin + buckets.pnlInrMargin / r;
  return { totalPnlInr, totalPnlUsdt };
}

/**
 * PnL to show on the ₹ INR table row: native INR-quote UR when present; otherwise
 * portfolio UR expressed in INR so the row matches EQ/UR when all open risk is USDT-quoted.
 */
export function inrBalanceRowUnrealizedPnl(
  buckets: { pnlInrMargin: number; pnlUsdtMargin: number },
  totalPnlInr: number,
): number {
  if (Math.abs(buckets.pnlInrMargin) > 1e-10) return buckets.pnlInrMargin;
  if (Math.abs(buckets.pnlUsdtMargin) > 1e-10) return totalPnlInr;
  return 0;
}

/** Return null when wallet ~0 so the TUI can show "—" instead of 0% with large UR. */
export function pnlPctVsWallet(rowPnl: number, walletBalance: number): number | null {
  if (Math.abs(walletBalance) < 1e-12) return null;
  return (rowPnl / walletBalance) * 100;
}

/** Util% = locked / total wallet; null when denominator ~0. */
export function utilPctVsWallet(locked: number, walletBalance: number): number | null {
  if (Math.abs(walletBalance) < 1e-12) return null;
  return (locked / walletBalance) * 100;
}
