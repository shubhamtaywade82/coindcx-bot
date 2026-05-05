import { bootstrapCore } from '../src/lifecycle/bootstrap';
import { CoinDCXApi } from '../src/gateways/coindcx-api';

async function main() {
  try {
    const cm = await CoinDCXApi.getFuturesCrossMarginDetails();
    console.log("Cross Margin:", JSON.stringify(cm, null, 2));
  } catch(e: any) {
    console.log("Cross margin error:", e.message);
  }
}
main();
