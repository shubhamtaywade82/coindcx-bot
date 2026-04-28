import { loadConfig } from '../config';
import { CoinDCXWs } from '../gateways/coindcx-ws';
import { ProbeRecorder } from '../marketdata/probe/probe-recorder';

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
  const pair = args.pair ?? 'B-SOL_USDT';
  const durationMs = Number(args.duration ?? '60') * 1000;
  const channels = (args.channels ?? 'depth-snapshot,depth-update,new-trade,currentPrices@futures#update')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const cfg = loadConfig();
  const rec = new ProbeRecorder({ dir: cfg.LOG_DIR, pair, channels, durationMs });
  const ws = new CoinDCXWs();

  for (const ch of channels) {
    ws.on(ch, (raw: unknown) => rec.record(ch, raw));
  }

  ws.connect();
  // eslint-disable-next-line no-console
  console.error(`probe: ${pair} for ${durationMs}ms, channels=${channels.join(',')}`);

  rec.scheduleStop(() => {
    // eslint-disable-next-line no-console
    console.error(`probe: done in ${rec.elapsedMs()}ms`);
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('probe fatal:', err);
  process.exit(1);
});
