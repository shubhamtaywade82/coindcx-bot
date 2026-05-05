import { CoinDCXApi } from '../src/gateways/coindcx-api';
import { bootstrapCore } from '../src/lifecycle/bootstrap';

async function main() {
  await bootstrapCore();
  try {
    const balances = await CoinDCXApi.getBalances();
    console.log("REST Balances:", JSON.stringify(balances, null, 2));
  } catch (e) {
    console.error("Error getting balances:", e);
  }
  
  try {
    const cm = await CoinDCXApi.getFuturesCrossMarginDetails();
    console.log("Futures Cross Margin Details:", JSON.stringify(cm, null, 2));
  } catch (e) {
    console.error("Error getting cross margin details:", e);
  }
}

main().catch(console.error);
