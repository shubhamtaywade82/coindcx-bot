import { __httpForTests } from '../src/gateways/coindcx-api';
import { CoinDCXApi } from '../src/gateways/coindcx-api';

async function main() {
  try {
    const futuresBalances = await CoinDCXApi['withClockSkewRetry'](
      'Balances',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const path = CoinDCXApi['futuresPath']('wallet_details', '/exchange/v1/derivatives/futures/wallets');
        console.log("Calling path:", path);
        const response = await __httpForTests.post(path, body, { headers });
        return response.data;
      }
    );
    console.log("Futures Wallet:", JSON.stringify(futuresBalances, null, 2));
  } catch (e: any) {
    console.error("Futures Wallet Error Full:", e);
    console.error("Message:", e.message);
    console.error("Response data:", e.response?.data);
  }
}
main();
