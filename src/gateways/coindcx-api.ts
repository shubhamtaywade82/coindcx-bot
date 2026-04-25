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
    try {
      // CoinDCX Futures Candle endpoint
      const response = await publicHttp.get('/exchange/v1/derivatives/futures/candles', {
        params: {
          pair,
          interval, // e.g., '5m', '15m', '1h'
          limit
        }
      });
      return response.data; // Array of [timestamp, open, high, low, close, volume]
    } catch (error: any) {
      console.error(`Error fetching candles for ${pair}:`, error.message);
      return [];
    }
  }
}
