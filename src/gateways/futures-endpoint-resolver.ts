import type { FuturesEndpointSpec } from '../config/futures-endpoints';
import { loadFuturesEndpointCatalog } from '../config/futures-endpoints';

let cachedCatalog: FuturesEndpointSpec | undefined;
let catalogLoadError: Error | undefined;

function isCapturedPath(path: string): boolean {
  return path !== 'TBD' && !path.includes('/TBD/');
}

function getCatalog(): FuturesEndpointSpec | undefined {
  if (cachedCatalog || catalogLoadError) return cachedCatalog;
  try {
    cachedCatalog = loadFuturesEndpointCatalog();
  } catch (error) {
    catalogLoadError = error instanceof Error ? error : new Error(String(error));
  }
  return cachedCatalog;
}

export interface ResolveFuturesEndpointOptions {
  fallbackPath?: string;
  catalog?: FuturesEndpointSpec;
}

export const DEFAULT_FUTURES_ENDPOINTS = {
  list_positions: '/exchange/v1/derivatives/futures/positions',
  list_orders: '/exchange/v1/derivatives/futures/orders',
  get_trades: '/exchange/v1/derivatives/futures/trade_history',
} as const;

export function resolveCatalogEndpointPath(key: string, catalog: FuturesEndpointSpec): string | undefined {
  const entry = catalog.endpoints.find((endpoint) => endpoint.key === key);
  if (!entry) return undefined;
  if (!isCapturedPath(entry.path)) return undefined;
  return entry.path;
}

export function resolveFuturesEndpointPath(
  key: string,
  opts: ResolveFuturesEndpointOptions = {},
): string {
  const catalog = opts.catalog ?? getCatalog();
  const configuredPath = catalog ? resolveCatalogEndpointPath(key, catalog) : undefined;
  if (configuredPath) {
    return configuredPath;
  }
  const builtinFallback = DEFAULT_FUTURES_ENDPOINTS[key as keyof typeof DEFAULT_FUTURES_ENDPOINTS];
  if (builtinFallback) {
    return builtinFallback;
  }
  if (opts.fallbackPath) {
    return opts.fallbackPath;
  }

  const loadErr = catalogLoadError ? ` Catalog load error: ${catalogLoadError.message}` : '';
  throw new Error(
    `Futures endpoint "${key}" is not captured in config/coindcx_futures_endpoints.yml.${loadErr}`,
  );
}

export function resetFuturesEndpointCatalogCacheForTests(): void {
  cachedCatalog = undefined;
  catalogLoadError = undefined;
}

