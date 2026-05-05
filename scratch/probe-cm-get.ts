import { __httpForTests } from '../src/gateways/coindcx-api';
import { CoinDCXApi } from '../src/gateways/coindcx-api';
import crypto from 'crypto';
import { config } from '../src/config/config';

async function main() {
  const timestamp = Date.now();
  const body = { timestamp };
  const payload = Buffer.from(JSON.stringify(body)).toString();
  const signature = crypto.createHmac('sha256', config.apiSecret).update(payload).digest('hex');
  const headers = {
    'Content-Type': 'application/json',
    'X-AUTH-APIKEY': config.apiKey,
    'X-AUTH-SIGNATURE': signature,
  };

  try {
    const path = '/exchange/v1/derivatives/futures/positions/cross_margin_details';
    console.log("Calling GET path:", path);
    const response = await __httpForTests.get(path, { headers, data: body });
    console.log("Futures Cross Margin GET:", JSON.stringify(response.data, null, 2));
  } catch (e: any) {
    console.error("Futures Cross Margin GET Error:", e?.response?.status, e?.response?.data);
  }
}
main();
