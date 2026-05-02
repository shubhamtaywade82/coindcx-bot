/* eslint-disable no-console */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { CoinDCXApi } from '../gateways/coindcx-api';
import { MarketStateBuilder } from '../ai/state-builder';
import { createLogger } from '../logging/logger';
import { SmcRule } from '../strategy/strategies/smc-rule';
import { MaCross } from '../strategy/strategies/ma-cross';
import { LlmPulse } from '../strategy/strategies/llm-pulse';
import { CandleSource } from '../strategy/backtest/sources/candle-source';
import { PostgresFillSource } from '../strategy/backtest/sources/postgres-fill-source';
import { JsonlSource } from '../strategy/backtest/sources/jsonl-source';
import { runBacktest } from '../strategy/backtest/runner';
import { tfMs } from '../strategy/scheduler/bar-driver';
import type { Strategy } from '../strategy/types';
import type { DataSource } from '../strategy/backtest/types';
import { AiAnalyzer } from '../ai/analyzer';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith('--') && argv[i + 1] !== undefined) {
      out[a.slice(2)] = argv[i + 1]!;
      i++;
    }
  }
  return out;
}

function pickStrategy(id: string, analyzer: AiAnalyzer): Strategy {
  if (id === 'smc.rule.v1') return new SmcRule();
  if (id === 'ma.cross.v1') return new MaCross();
  if (id === 'llm.pulse.v1') return new LlmPulse(analyzer);
  throw new Error(`unknown strategy: ${id}`);
}

async function main() {
  const cfg = loadConfig();
  const logger = await createLogger({
    level: cfg.LOG_LEVEL, logDir: cfg.LOG_DIR,
    rotateMb: cfg.LOG_FILE_ROTATE_MB, keep: cfg.LOG_FILE_KEEP,
  });

  const args = parseArgs(process.argv.slice(2));
  const strategyId = args.strategy ?? 'smc.rule.v1';
  const pair = args.pair ?? 'B-BTC_USDT';
  const fromMs = Date.parse(args.from ?? '2026-04-01T00:00:00Z');
  const toMs = Date.parse(args.to ?? '2026-04-25T00:00:00Z');
  const sourceKind = args.source ?? 'candles';
  const tf = args.tf ?? '15m';
  const outDir = cfg.BACKTEST_OUTPUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const out = args.out ?? join(outDir, `${strategyId}-${pair}-${Date.now()}.csv`);

  const stateBuilder = new MarketStateBuilder(logger);
  const analyzer = new AiAnalyzer(cfg, logger);
  const strategy = pickStrategy(strategyId, analyzer);

  let dataSource: DataSource;
  if (sourceKind === 'candles') {
    dataSource = new CandleSource({
      pair, tf, fromMs, toMs,
      fetcher: async (p, t, fm, tm) => {
        const limit = Math.max(1, Math.ceil((tm - fm) / tfMs(t)));
        const raw: any[] = await CoinDCXApi.getCandles(p, t, limit);
        return raw.map((row: any[]) => ({
          ts: Number(row[0]),
          o: Number(row[1]),
          h: Number(row[2]),
          l: Number(row[3]),
          c: Number(row[4]),
        }));
      },
    });
  } else if (sourceKind === 'postgres-fills') {
    const pool = new Pool({ connectionString: cfg.PG_URL });
    dataSource = new PostgresFillSource({ pool, pair, fromMs, toMs });
  } else if (sourceKind === 'jsonl') {
    dataSource = new JsonlSource({ path: args.path ?? '', pair, fromMs, toMs });
  } else {
    throw new Error(`unknown source: ${sourceKind}`);
  }

  console.error(`[backtest] strategy=${strategyId} pair=${pair} source=${sourceKind} from=${args.from} to=${args.to}`);
  const summary = await runBacktest({
    strategy, pair, dataSource,
    buildMarketState: (htf, ltf, p) => stateBuilder.build(htf, ltf, null, [], p),
    pessimistic: cfg.BACKTEST_PESSIMISTIC,
    outCsv: out,
  });
  console.log(JSON.stringify({
    strategyId, pair, fromMs, toMs, source: sourceKind,
    metrics: summary.metrics, coverage: summary.coverage, events: summary.events, csv: out,
  }, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('[backtest] fatal:', err);
  process.exit(1);
});
