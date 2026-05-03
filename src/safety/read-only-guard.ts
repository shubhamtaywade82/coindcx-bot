import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

export interface WriteRateLimitPolicy {
  pathPrefix: string;
  maxRequests: number;
  windowMs: number;
}

export const WRITE_RATE_LIMIT_POLICIES: readonly WriteRateLimitPolicy[] = [
  { pathPrefix: '/exchange/v1/orders/cancel_all', maxRequests: 30, windowMs: 60_000 },
  { pathPrefix: '/exchange/v1/derivatives/futures/orders/cancel_all', maxRequests: 30, windowMs: 60_000 },
];

export function getWriteRateLimitPolicy(path: string): WriteRateLimitPolicy | undefined {
  return WRITE_RATE_LIMIT_POLICIES.find((p) => path.startsWith(p.pathPrefix));
}

export class ReadOnlyViolation extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly rateLimitPolicy?: WriteRateLimitPolicy,
  ) {
    const suffix = rateLimitPolicy
      ? ` (rate-limit policy: ${rateLimitPolicy.maxRequests}/${Math.floor(rateLimitPolicy.windowMs / 1000)}s)`
      : '';
    super(`Read-only violation: ${method} ${path}${suffix}`);
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
  '/exchange/v1/wallets/transfer',
  '/exchange/v1/wallets/sub_account_transfer',
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
const SIGNED_READ_POST_PATHS: readonly string[] = [
  '/exchange/v1/derivatives/futures/positions',
  '/exchange/v1/derivatives/futures/orders',
  '/exchange/v1/derivatives/futures/trade_history',
  '/exchange/v1/derivatives/futures/orders/status',
  '/exchange/v1/derivatives/futures/wallets',
  '/exchange/v1/margin/fetch_orders',
  '/exchange/v1/funding/fetch_orders',
  '/exchange/v1/users/balances',
  '/exchange/v1/users/info',
  '/exchange/v1/orders/active_orders',
  '/exchange/v1/orders/active_orders_count',
  '/exchange/v1/orders/trade_history',
  '/exchange/v1/orders/status',
  '/exchange/v1/orders/status_multiple',
];

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function applyReadOnlyGuard(client: AxiosInstance, opts: GuardOptions = {}): void {
  const deny = [...DENY_PATHS, ...(opts.extraDenyPaths ?? [])];
  const allowPosts = [...SIGNED_READ_POST_PATHS, ...(opts.signedReadPostPaths ?? [])];

  client.interceptors.request.use((req: InternalAxiosRequestConfig) => {
    const method = (req.method ?? 'get').toUpperCase();
    const path = req.url ?? '';
    const rateLimitPolicy = method === 'POST' ? getWriteRateLimitPolicy(path) : undefined;

    if (deny.some((p) => path.startsWith(p))) {
      opts.onViolation?.({ method, path });
      throw new ReadOnlyViolation(method, path, rateLimitPolicy);
    }

    if (WRITE_VERBS.has(method)) {
      const allowed = method === 'POST' && allowPosts.some((p) => path.startsWith(p));
      if (!allowed) {
        opts.onViolation?.({ method, path });
        throw new ReadOnlyViolation(method, path, rateLimitPolicy);
      }
    }
    return req;
  });
}
