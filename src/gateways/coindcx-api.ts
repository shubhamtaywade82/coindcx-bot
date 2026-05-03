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
    const header = response.headers?.date;
    if (typeof header !== 'string') {
      throw new Error('Clock-sync failed: missing Date header');
    }
    const serverMs = Date.parse(header);
    if (Number.isNaN(serverMs)) {
      throw new Error(`Clock-sync failed: invalid Date header "${header}"`);
    }
    return serverMs;
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
        const serverTimestamp = await this.fetchServerTimestamp();
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
    try {
      const response = await publicHttp.get('/exchange/ticker');
      return response.data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching tickers:', error);
      return [];
    }
  }

  static async getMarketDetails() {
    try {
      const response = await publicHttp.get('/exchange/v1/markets_details');
      return response.data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching market details:', error);
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
