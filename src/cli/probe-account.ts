/* eslint-disable no-console */
import { CoinDCXApi } from '../gateways/coindcx-api';
import { CoinDCXWs } from '../gateways/coindcx-ws';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] ?? '';
      args[k] = v;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const durationSec = Number(args.duration ?? 60);
  console.error(`[probe-account] duration=${durationSec}s`);

  const ws = new CoinDCXWs();
  ws.on('df-position-update', raw => console.log(JSON.stringify({ ch: 'position', raw })));
  ws.on('df-order-update', raw => console.log(JSON.stringify({ ch: 'order', raw })));
  ws.on('balance-update', raw => console.log(JSON.stringify({ ch: 'balance', raw })));
  ws.on('df-trade-update', raw => console.log(JSON.stringify({ ch: 'fill', raw })));
  ws.connect();

  try {
    const restPositions = await CoinDCXApi.getFuturesPositions();
    console.error('[probe-account][rest] positions:', JSON.stringify(restPositions).slice(0, 800));
    const restBalances = await CoinDCXApi.getBalances();
    console.error('[probe-account][rest] balances:', JSON.stringify(restBalances).slice(0, 400));
    const restOrders = await CoinDCXApi.getOpenOrders();
    console.error('[probe-account][rest] orders:', JSON.stringify(restOrders).slice(0, 400));
    const restTrades = await CoinDCXApi.getFuturesTradeHistory({ size: 50 });
    console.error('[probe-account][rest] trades:', JSON.stringify(restTrades).slice(0, 800));
  } catch (err: any) {
    console.error('[probe-account][rest] error:', err.message);
  }

  await new Promise(r => setTimeout(r, durationSec * 1000));
  console.error('[probe-account] done');
  process.exit(0);
}

main().catch(err => {
  console.error('[probe-account] fatal:', err);
  process.exit(1);
});
