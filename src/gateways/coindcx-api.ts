import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config/config';
import { applyReadOnlyGuard } from '../safety/read-only-guard';

const http: AxiosInstance = axios.create({ baseURL: config.apiBaseUrl, timeout: 10_000 });
const publicHttp: AxiosInstance = axios.create({ baseURL: config.publicBaseUrl, timeout: 10_000 });

applyReadOnlyGuard(http, {
  onViolation: ({ method, path }) => {
    // eslint-disable-next-line no-console
    console.error(`[ReadOnlyGuard] blocked ${method} ${path}`);
  },
});
applyReadOnlyGuard(publicHttp, {
  onViolation: ({ method, path }) => {
    // eslint-disable-next-line no-console
    console.error(`[ReadOnlyGuard] blocked ${method} ${path}`);
  },
});

export const __httpForTests = http;
export const __publicHttpForTests = publicHttp;

export class CoinDCXApi {
  private static readonly clockSkewRetryStatuses = new Set([400, 401, 403]);

  private static sign(payload: string): string {
    return crypto
      .createHmac('sha256', config.apiSecret)
      .update(payload)
      .digest('hex');
  }

  private static get authHeaders() {
    return {
      'Content-Type': 'application/json',
    };
  }

  private static buildSignedRequest(body: Record<string, any>) {
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = this.sign(payload);
    return {
      body,
      headers: {
        ...this.authHeaders,
        'X-AUTH-APIKEY': config.apiKey,
        'X-AUTH-SIGNATURE': signature,
      },
    };
  }

  private static isClockSkewError(error: any): boolean {
    const status = error?.response?.status;
    if (!this.clockSkewRetryStatuses.has(status)) return false;
    const message = String(error?.response?.data?.message ?? error?.message ?? '');
    return /(timestamp|clock|ahead|behind|expired|nonce|recvwindow)/i.test(message);
  }

  private static async fetchServerTimestamp(): Promise<number> {
    const response = await axios.get(`${config.apiBaseUrl}/exchange/v1/markets`, { timeout: 5_000 });
    const serverMs = this.parseDateHeader(response.headers);
    if (serverMs === undefined) throw new Error('Clock-sync failed: missing or invalid Date header');
    return serverMs;
  }

  private static parseDateHeader(headers: unknown): number | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const raw =
      (headers as Record<string, unknown>)['date'] ??
      (headers as Record<string, unknown>)['Date'];
    if (typeof raw !== 'string') return undefined;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private static readServerTimestampFromError(error: any): number | undefined {
    return this.parseDateHeader(error?.response?.headers);
  }

  private static formatApiError(endpoint: string, error: any): Error {
    const status = error?.response?.status;
    const msg = error?.response?.data?.message || error?.message;
    return new Error(`${endpoint} API [${status || 'timeout'}]: ${msg}`);
  }

  private static async withClockSkewRetry<T>(
    endpoint: string,
    bodyBuilder: (timestamp: number) => Record<string, any>,
    execute: (req: { body: Record<string, any>; headers: Record<string, string> }) => Promise<T>,
  ): Promise<T> {
    const firstRequest = this.buildSignedRequest(bodyBuilder(Date.now()));
    try {
      return await execute(firstRequest);
    } catch (error: any) {
      if (!this.isClockSkewError(error)) {
        throw this.formatApiError(endpoint, error);
      }
      try {
        const serverTimestamp =
          this.readServerTimestampFromError(error) ?? await this.fetchServerTimestamp();
        const retryRequest = this.buildSignedRequest(bodyBuilder(serverTimestamp));
        return await execute(retryRequest);
      } catch (retryError: any) {
        throw this.formatApiError(endpoint, retryError);
      }
    }
  }

  static async getBalances() {
    return this.withClockSkewRetry(
      'Balances',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.get('/exchange/v1/derivatives/futures/wallets', {
        data: body,
        headers,
      });
        return response.data;
      },
    );
  }

  static async getUserBalances() {
    return this.withClockSkewRetry(
      'UserBalances',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/users/balances', body, { headers });
        return response.data;
      },
    );
  }

  static async getSpotBalances() {
    return this.getUserBalances();
  }

  static async getUserInfo() {
    return this.withClockSkewRetry(
      'UserInfo',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/users/info', body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesPositions() {
    return this.withClockSkewRetry(
      'Positions',
      (timestamp) => ({
        timestamp,
        page: '1',
        size: '100',
        margin_currency_short_name: ['USDT', 'INR'],
      }),
      async ({ body, headers }) => {
        const response = await http.post(
        '/exchange/v1/derivatives/futures/positions',
        body,
        { headers },
      );
        return response.data;
      },
    );
  }

  static async getOpenOrders() {
    return this.withClockSkewRetry(
      'OpenOrders',
      (timestamp) => ({
        timestamp,
        status: 'open',
        page: '1',
        size: '100',
        margin_currency_short_name: ['USDT', 'INR'],
      }),
      async ({ body, headers }) => {
        const response = await http.post(
        '/exchange/v1/derivatives/futures/orders',
        body,
        { headers },
      );
        return response.data;
      },
    );
  }

  static async getSpotOrderStatus(idOrClientOrderId: string) {
    return this.withClockSkewRetry(
      'SpotOrderStatus',
      (timestamp) => ({ timestamp, id: idOrClientOrderId }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status', body, { headers });
        return response.data;
      },
    );
  }

  static async getOrderStatus(opts: { id?: string; clientOrderId?: string }) {
    const id = opts.id?.trim();
    const clientOrderId = opts.clientOrderId?.trim();
    if (!id && !clientOrderId) {
      throw new Error('getOrderStatus requires id or clientOrderId');
    }
    return this.withClockSkewRetry(
      'OrderStatus',
      (timestamp) => ({
        timestamp,
        ...(id ? { id } : {}),
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status', body, { headers });
        return response.data;
      },
    );
  }

  static async getSpotOrderStatusMultiple(ids: string[]) {
    return this.withClockSkewRetry(
      'SpotOrderStatusMultiple',
      (timestamp) => ({ timestamp, id: ids }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status_multiple', body, { headers });
        return response.data;
      },
    );
  }

  static async getOrderStatusMultiple(ids: string[]) {
    return this.withClockSkewRetry(
      'OrderStatusMultiple',
      (timestamp) => ({ timestamp, id: ids }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status_multiple', body, { headers });
        return response.data;
      },
    );
  }

  static async getSpotActiveOrders(market: string) {
    return this.withClockSkewRetry(
      'SpotActiveOrders',
      (timestamp) => ({ timestamp, market }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/active_orders', body, { headers });
        return response.data;
      },
    );
  }

  static async getActiveOrders(market: string) {
    return this.getSpotActiveOrders(market);
  }

  static async getSpotActiveOrdersCount() {
    return this.withClockSkewRetry(
      'SpotActiveOrdersCount',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/active_orders_count', body, { headers });
        return response.data;
      },
    );
  }

  static async getActiveOrdersCount() {
    return this.getSpotActiveOrdersCount();
  }

  static async getSpotTradeHistory(opts: { market?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Math.trunc(opts.page ?? 1));
    const limit = Math.max(1, Math.trunc(opts.limit ?? 100));
    const market = opts.market?.trim();
    return this.withClockSkewRetry(
      'SpotTradeHistory',
      (timestamp) => ({
        timestamp,
        page,
        limit,
        ...(market ? { market } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/trade_history', body, { headers });
        return response.data;
      },
    );
  }

  static async getMarginOrders(opts: { market?: string; id?: string } = {}) {
    return this.withClockSkewRetry(
      'MarginFetchOrders',
      (timestamp) => ({
        timestamp,
        ...(opts.market ? { market: opts.market } : {}),
        ...(opts.id ? { id: opts.id } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/margin/fetch_orders', body, { headers });
        return response.data;
      },
    );
  }

  static async getMarginOrderStatus(opts: { id?: string; clientOrderId?: string } = {}) {
    const id = opts.id?.trim();
    const clientOrderId = opts.clientOrderId?.trim();
    if (!id && !clientOrderId) {
      throw new Error('getMarginOrderStatus requires id or clientOrderId');
    }
    return this.withClockSkewRetry(
      'MarginOrderStatus',
      (timestamp) => ({
        timestamp,
        ...(id ? { id } : {}),
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/margin/order', body, { headers });
        return response.data;
      },
    );
  }

  static async getFundingOrders(opts: { page?: number; limit?: number } = {}) {
    return this.withClockSkewRetry(
      'FundingFetchOrders',
      (timestamp) => ({
        timestamp,
        page: opts.page ?? 1,
        limit: opts.limit ?? 100,
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/funding/fetch_orders', body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesTradeHistory(opts: { fromTimestamp?: number; size?: number } = {}) {
    return this.withClockSkewRetry(
      'TradeHistory',
      (timestamp) => ({
        timestamp,
        from_timestamp: opts.fromTimestamp ?? 0,
        size: String(opts.size ?? 100),
        margin_currency_short_name: ['USDT', 'INR'],
      }),
      async ({ body, headers }) => {
        const response = await http.post(
        '/exchange/v1/derivatives/futures/trade_history',
        body,
        { headers },
      );
        return response.data;
      },
    );
  }

  static async getTickers() {
    return this.fetchPublic('tickers', '/exchange/ticker');
  }

  static async getMarkets() {
    return this.fetchPublic('markets', '/exchange/v1/markets');
  }

  static async getMarketDetails() {
    return this.fetchPublic('market details', '/exchange/v1/markets_details');
  }

  static async getPublicTradeHistory(pair: string, limit = 100) {
    return this.fetchPublic('public trade history', '/market_data/trade_history', { pair, limit });
  }

  static async getPublicOrderBook(pair: string) {
    return this.fetchPublic('public orderbook', '/market_data/orderbook', { pair });
  }

  static async getPublicOrderbook(pair: string) {
    return this.getPublicOrderBook(pair);
  }

  private static async fetchPublic(label: string, path: string, params?: Record<string, unknown>) {
    try {
      const response = await publicHttp.get(path, params ? { params } : undefined);
      return response.data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching ${label}:`, error);
      return [];
    }
  }

  static async getCandles(pair: string, interval: string, limit = 100) {
    // CoinDCX futures candlesticks: public.coindcx.com/market_data/candlesticks
    // resolution units: minutes (e.g. 1, 5, 15, 60, 240, "1D")
    const intervalToResolution: Record<string, string> = {
      '1m': '1', '5m': '5', '15m': '15', '30m': '30',
      '1h': '60', '4h': '240', '1d': '1D'
    };
    const resolution = intervalToResolution[interval] ?? interval;
    const stepSeconds = resolution === '1D' ? 86_400 : Number(resolution) * 60;
    const to = Math.floor(Date.now() / 1000);
    const from = to - stepSeconds * limit;
    try {
      const response = await publicHttp.get('/market_data/candlesticks', {
        params: { pair, from, to, resolution, pcode: 'f' },
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      const raw = response.data?.data ?? response.data;
      if (!Array.isArray(raw)) return [];
      // Normalise to [timestamp, open, high, low, close, volume]
      return raw.map((c: any) => Array.isArray(c)
        ? c
        : [c.time ?? c.t ?? c.timestamp, c.open ?? c.o, c.high ?? c.h, c.low ?? c.l, c.close ?? c.c, c.volume ?? c.v]
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const body = error?.response?.data;
      console.error(`Error fetching candles for ${pair} [${interval}] status=${status}:`, error.message, body);
      throw error;
    }
  }
}
