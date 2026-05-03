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

export function resolveFuturesEndpointPath(
  key: string,
  opts: ResolveFuturesEndpointOptions = {},
): string {
  const catalog = opts.catalog ?? getCatalog();
  if (catalog && !catalog.endpoints.some((endpoint) => endpoint.key === key)) {
    throw new Error(`Unknown futures endpoint key: "${key}"`);
  }
  const entry = catalog?.endpoints.find((endpoint) => endpoint.key === key);
  if (entry && isCapturedPath(entry.path)) {
    return entry.path;
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

