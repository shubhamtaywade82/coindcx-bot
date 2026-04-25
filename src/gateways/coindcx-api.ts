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

  static async getBalances() {
    const timestamp = Date.now();
    const body = { timestamp };
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = this.sign(payload);

    try {
      const response = await axios.post(`${config.apiBaseUrl}/exchange/v1/users/balances`, body, {
        headers: {
          'X-AUTH-APIKEY': config.apiKey,
          'X-AUTH-SIGNATURE': signature,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching balances:', error);
      return [];
    }
  }

  static async getFuturesPositions() {
    const timestamp = Date.now();
    const body = { timestamp };
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = this.sign(payload);

    try {
      const response = await axios.post(`${config.apiBaseUrl}/exchange/v1/derivatives/futures/positions`, body, {
        headers: {
          'X-AUTH-APIKEY': config.apiKey,
          'X-AUTH-SIGNATURE': signature,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching futures positions:', error);
      return [];
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
