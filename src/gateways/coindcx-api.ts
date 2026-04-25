import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/config';

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
      const response = await axios.post(
        `${config.apiBaseUrl}/exchange/v1/users/balances`,
        body,
        { headers, timeout: 10000 },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`Balances API [${status || 'timeout'}]: ${msg}`);
    }
  }

  static async getFuturesPositions() {
    const { body, headers } = this.buildSignedRequest({ timestamp: Date.now() });
    try {
      const response = await axios.post(
        `${config.apiBaseUrl}/exchange/v1/derivatives/futures/positions`,
        body,
        { headers, timeout: 10000 },
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      throw new Error(`Positions API [${status || 'timeout'}]: ${msg}`);
    }
  }

  static async getMarketDetails() {
    try {
      const response = await axios.get(`${config.publicBaseUrl}/exchange/v1/markets_details`);
      return response.data;
    } catch (error) {
      console.error('Error fetching market details:', error);
      return [];
    }
  }
}
