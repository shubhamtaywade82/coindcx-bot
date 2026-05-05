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
  requireCaptured?: boolean;
}

export const DEFAULT_FUTURES_ENDPOINTS = {
  get_active_instruments: '/exchange/v1/derivatives/futures/data/active_instruments',
  get_instrument_details: '/exchange/v1/derivatives/futures/data/instrument',
  get_instrument_trade_history: '/exchange/v1/derivatives/futures/data/trades',
  get_instrument_orderbook: '/market_data/v3/orderbook/{instrument}-futures/50',
  get_instrument_candlesticks: '/market_data/candlesticks',
  list_positions: '/exchange/v1/derivatives/futures/positions',
  get_positions_by_pair_or_position_id: '/exchange/v1/derivatives/futures/positions',
  update_position_leverage: '/exchange/v1/derivatives/futures/positions/update_leverage',
  add_margin: '/exchange/v1/derivatives/futures/positions/add_margin',
  remove_margin: '/exchange/v1/derivatives/futures/positions/remove_margin',
  exit_position: '/exchange/v1/derivatives/futures/positions/exit',
  list_orders: '/exchange/v1/derivatives/futures/orders',
  create_order: '/exchange/v1/derivatives/futures/orders/create',
  cancel_order: '/exchange/v1/derivatives/futures/orders/cancel',
  edit_order: '/exchange/v1/derivatives/futures/orders/edit',
  cancel_all_open_orders: '/exchange/v1/derivatives/futures/positions/cancel_all_open_orders',
  cancel_all_open_orders_for_position:
    '/exchange/v1/derivatives/futures/positions/cancel_all_open_orders_for_position',
  create_take_profit_stop_loss_orders: '/exchange/v1/derivatives/futures/positions/create_tpsl',
  get_transactions: '/exchange/v1/derivatives/futures/positions/transactions',
  get_trades: '/exchange/v1/derivatives/futures/trades',
  get_current_prices_rt: '/market_data/v3/current_prices/futures/rt',
  get_pair_stats: '/api/v1/derivatives/futures/data/stats',
  get_cross_margin_details: '/exchange/v1/derivatives/futures/positions/cross_margin_details',
  wallet_transfer: '/exchange/v1/derivatives/futures/wallets/transfer',
  wallet_details: '/exchange/v1/derivatives/futures/wallets',
  wallet_transactions: '/exchange/v1/derivatives/futures/wallets/transactions',
  change_position_margin_type: '/exchange/v1/derivatives/futures/positions/margin_type',
  get_currency_conversion: '/api/v1/derivatives/futures/data/conversions',
} as const;

export function resolveCatalogEndpointPath(key: string, catalog: FuturesEndpointSpec): string | undefined {
  const entry = catalog.endpoints.find((endpoint) => endpoint.key === key);
  if (!entry) return undefined;
  if (!isCapturedPath(entry.path)) return undefined;
  return entry.path;
}

function hasCatalogKey(key: string, catalog?: FuturesEndpointSpec): boolean {
  return Boolean(catalog?.endpoints.some((endpoint) => endpoint.key === key));
}

function hasBuiltinKey(key: string): boolean {
  return key in DEFAULT_FUTURES_ENDPOINTS;
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
  if (!opts.requireCaptured && builtinFallback) {
    return builtinFallback;
  }
  if (!opts.requireCaptured && opts.fallbackPath) {
    return opts.fallbackPath;
  }

  if (!hasCatalogKey(key, catalog) && !hasBuiltinKey(key) && !opts.fallbackPath) {
    throw new Error(`Unknown futures endpoint key "${key}".`);
  }

  const loadErr = catalogLoadError ? ` Catalog load error: ${catalogLoadError.message}` : '';
  throw new Error(
    `Futures endpoint "${key}" is not captured in config/coindcx_futures_endpoints.yml.${loadErr}`,
  );
}

export function resolveFuturesPath(
  key: string,
  fallbackPath: string,
  opts: { requireCaptured?: boolean; catalog?: FuturesEndpointSpec } = {},
): string {
  return resolveFuturesEndpointPath(key, {
    fallbackPath,
    catalog: opts.catalog,
    requireCaptured: opts.requireCaptured,
  });
}

export function resetFuturesEndpointCatalogCacheForTests(): void {
  cachedCatalog = undefined;
  catalogLoadError = undefined;
}

