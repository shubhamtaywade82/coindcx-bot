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
}

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function applyReadOnlyGuard(client: AxiosInstance, opts: GuardOptions = {}): void {
  const deny = [...DENY_PATHS, ...(opts.extraDenyPaths ?? [])];
  client.interceptors.request.use((req: InternalAxiosRequestConfig) => {
    const method = (req.method ?? 'get').toUpperCase();
    const path = req.url ?? '';
    const violated = WRITE_VERBS.has(method) || deny.some((p) => path.startsWith(p));
    if (violated) {
      opts.onViolation?.({ method, path });
      throw new ReadOnlyViolation(method, path);
    }
    return req;
  });
}
