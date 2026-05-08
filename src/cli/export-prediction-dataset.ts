/**
 * Offline export of resolved strategy_prediction_outcomes for ML / analytics.
 * Reads PG_URL from the environment (via loadConfig). Does not run strategies or Ollama.
 *
 * Usage:
 *   npx ts-node src/cli/export-prediction-dataset.ts [--out path.jsonl]
 * If --out is omitted, writes JSONL to stdout.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { loadConfig } from '../config';
import { getPool, closePool } from '../db/pool';

function parseOutPath(argv: string[]): string | null {
  const i = argv.indexOf('--out');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return null;
}

async function main(): Promise<void> {
  const outPath = parseOutPath(process.argv.slice(2));
  loadConfig();
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, client_signal_id, strategy, pair, signal_ts, side,
            entry::text AS entry, stop_loss::text AS stop_loss, take_profit::text AS take_profit,
            outcome, resolved_ts, bars_examined, feature_snapshot, status, ttl_ms::text AS ttl_ms
     FROM strategy_prediction_outcomes
     WHERE status = 'resolved' AND outcome IS NOT NULL
     ORDER BY resolved_ts ASC NULLS LAST`,
  );
  const lines = r.rows.map((row) => JSON.stringify(row));
  const body = lines.join('\n') + (lines.length ? '\n' : '');
  if (outPath) {
    fs.writeFileSync(outPath, body, 'utf8');
    process.stderr.write(`Wrote ${r.rows.length} rows to ${outPath}\n`);
  } else {
    process.stdout.write(body);
  }
  await closePool();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`export-prediction-dataset failed: ${msg}\n`);
  process.exit(1);
});
