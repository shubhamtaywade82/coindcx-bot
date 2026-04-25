import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

export class ReadOnlyViolation extends Error {
  constructor(public readonly method: string, public readonly path: string) {
    super(`Read-only violation: ${method} ${path}`);
    this.name = 'ReadOnlyViolation';
  }
}

export const DENY_PATHS: readonly string[] = [
  '/exchange/v1/orders/create',
  '/exchange/v1/orders/cancel',
  '/exchange/v1/orders/edit',
  '/exchange/v1/orders/cancel_all',
  '/exchange/v1/orders/cancel_by_ids',
  '/exchange/v1/funds/transfer',
  '/exchange/v1/derivatives/futures/orders/create',
  '/exchange/v1/derivatives/futures/orders/cancel',
  '/exchange/v1/derivatives/futures/orders/edit',
  '/exchange/v1/derivatives/futures/orders/cancel_all',
  '/exchange/v1/derivatives/futures/positions/exit',
];

export interface GuardOptions {
  onViolation?: (info: { method: string; path: string }) => void;
  extraDenyPaths?: string[];
  /**
   * POST paths that are read-only despite using POST (CoinDCX signed-read pattern).
   * Match is exact prefix.
   */
  signedReadPostPaths?: string[];
}

/** CoinDCX uses POST for some authenticated read endpoints. Allowlist below. */
export const SIGNED_READ_POST_PATHS: readonly string[] = [
  '/exchange/v1/derivatives/futures/positions',
  '/exchange/v1/derivatives/futures/orders',
  '/exchange/v1/derivatives/futures/trade_history',
  '/exchange/v1/derivatives/futures/orders/status',
  '/exchange/v1/derivatives/futures/wallets',
  '/exchange/v1/users/balances',
  '/exchange/v1/orders/active_orders',
  '/exchange/v1/orders/trade_history',
  '/exchange/v1/orders/status',
];

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function applyReadOnlyGuard(client: AxiosInstance, opts: GuardOptions = {}): void {
  const deny = [...DENY_PATHS, ...(opts.extraDenyPaths ?? [])];
  const allowPosts = [...SIGNED_READ_POST_PATHS, ...(opts.signedReadPostPaths ?? [])];

  client.interceptors.request.use((req: InternalAxiosRequestConfig) => {
    const method = (req.method ?? 'get').toUpperCase();
    const path = req.url ?? '';

    if (deny.some((p) => path.startsWith(p))) {
      opts.onViolation?.({ method, path });
      throw new ReadOnlyViolation(method, path);
    }

    if (WRITE_VERBS.has(method)) {
      const allowed = method === 'POST' && allowPosts.some((p) => path.startsWith(p));
      if (!allowed) {
        opts.onViolation?.({ method, path });
        throw new ReadOnlyViolation(method, path);
      }
    }
    return req;
  });
}
