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

  static async getBalances() {
    const { body, headers } = this.buildSignedRequest({ timestamp: Date.now() });
    try {
      const response = await http.get('/exchange/v1/derivatives/futures/wallets', {
        data: body,
        headers,
      });
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`Balances API [${status || 'timeout'}]: ${msg}`);
    }
  }

  static async getFuturesPositions() {
    const { body, headers } = this.buildSignedRequest({
      timestamp: Date.now(),
      page: '1',
      size: '100',
      margin_currency_short_name: ['USDT', 'INR'],
    });
    try {
      const response = await http.post(
        '/exchange/v1/derivatives/futures/positions',
        body,
        { headers },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`Positions API [${status || 'timeout'}]: ${msg}`);
    }
  }

  static async getOpenOrders() {
    const { body, headers } = this.buildSignedRequest({
      timestamp: Date.now(),
      status: 'open',
      page: '1',
      size: '100',
      margin_currency_short_name: ['USDT', 'INR'],
    });
    try {
      const response = await http.post(
        '/exchange/v1/derivatives/futures/orders',
        body,
        { headers },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`OpenOrders API [${status || 'timeout'}]: ${msg}`);
    }
  }

  static async getFuturesTradeHistory(opts: { fromTimestamp?: number; size?: number } = {}) {
    const { body, headers } = this.buildSignedRequest({
      timestamp: Date.now(),
      from_timestamp: opts.fromTimestamp ?? 0,
      size: String(opts.size ?? 100),
      margin_currency_short_name: ['USDT', 'INR'],
    });
    try {
      const response = await http.post(
        '/exchange/v1/derivatives/futures/trade_history',
        body,
        { headers },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`TradeHistory API [${status || 'timeout'}]: ${msg}`);
    }
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
