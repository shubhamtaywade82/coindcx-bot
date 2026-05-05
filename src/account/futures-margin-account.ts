/**
 * CoinDCX futures cross-margin account snapshot (`…/positions/cross_margin_details`).
 * Used when per-currency `/derivatives/futures/wallets` rows under-report wallet equity.
 * @see https://docs.coindcx.com — Cross Margin Details response.
 */

export type FuturesMarginAccountSnapshot = {
  unrealizedPnl: number;
  totalWalletBalance: number;
  totalAccountEquity: number;
  withdrawableBalance: number;
  totalInitialMargin: number;
  maintenanceMargin: number;
  /** Cross margin ratio from exchange (liquidation when ≥ 1 per CoinDCX docs). */
  marginRatioCross: number;
  updatedAt: string;
};

function n(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = String(v ?? '')
    .trim()
    .replace(/,/g, '');
  if (!t || t === 'null' || t === 'undefined') return 0;
  const x = parseFloat(t);
  return Number.isFinite(x) ? x : 0;
}

/** Parse REST `cross_margin_details` body; returns null if not a usable object. */
export function parseCrossMarginDetails(raw: unknown): FuturesMarginAccountSnapshot | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const totalWalletBalance = n(o.total_wallet_balance);
  const totalAccountEquity = n(o.total_account_equity);
  const pnl = n(o.pnl);
  if (Math.abs(pnl) < 1e-12 && totalWalletBalance < 1e-12 && Math.abs(totalAccountEquity) < 1e-12) {
    return null;
  }
  return {
    unrealizedPnl: pnl,
    totalWalletBalance,
    totalAccountEquity,
    withdrawableBalance: n(o.withdrawable_balance),
    totalInitialMargin: n(o.total_initial_margin),
    maintenanceMargin: n(o.maintenance_margin),
    marginRatioCross: n(o.margin_ratio_cross),
    updatedAt: new Date().toISOString(),
  };
}

function walletPairTotal(available: string, locked: string): number {
  return parseFloat(available || '0') + parseFloat(locked || '0');
}

/**
 * WS must not wipe REST-filled wallet with an all-zero partial. Prefer prior
 * non-zero `balance` / `locked_balance` when the incoming row is effectively empty.
 */
export function mergeCoinDcxBalanceWsPayload(
  prev: { balance: string; locked: string } | undefined,
  incomingAvailable: string,
  incomingLocked: string,
): { balance: string; locked: string } {
  if (!prev) {
    return { balance: incomingAvailable, locked: incomingLocked };
  }
  const prevT = walletPairTotal(prev.balance, prev.locked);
  const incT = walletPairTotal(incomingAvailable, incomingLocked);
  if (prevT > 1e-8 && incT < 1e-8) return { ...prev };
  return { balance: incomingAvailable, locked: incomingLocked };
}
