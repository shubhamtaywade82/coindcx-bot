/* eslint-disable no-console */
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { CandleHistoryIngestor } from '../marketdata/candles/candle-history-ingestor';
import { CandleHistoryPersistence } from '../persistence/candle-history-persistence';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined) continue;
    out[key] = value;
    index += 1;
  }
  return out;
}

function parseDateMs(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const pair = args.pair ?? (cfg.COINDCX_PAIRS[0] ?? 'B-BTC_USDT');
  const timeframes = (args.timeframes ?? cfg.BACKTEST_CANDLE_DEFAULT_TIMEFRAMES.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const toMs = parseDateMs(args.to, Date.now());
  const fromMs = parseDateMs(
    args.from,
    toMs - (30 * 24 * 60 * 60_000),
  );
  const source = args.source ?? 'coindcx.market_data.candlesticks';

  const pool = new Pool({ connectionString: cfg.PG_URL });
  const persistence = new CandleHistoryPersistence(pool);
  const ingestor = new CandleHistoryIngestor({
    persistence,
    maxBarsPerCall: cfg.BACKTEST_CANDLE_MAX_BARS_PER_CALL,
  });

  try {
    const summary = await ingestor.ingestMultiIntervalHistory({
      pair,
      timeframes,
      fromMs,
      toMs,
      source,
    });
    console.log(JSON.stringify({
      pair,
      timeframes,
      fromMs,
      toMs,
      pages: summary.pages,
      fetched: summary.fetched,
      persisted: summary.persisted,
      byTimeframe: summary.byTimeframe,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error('[candle-history] fatal:', error);
  process.exit(1);
});
