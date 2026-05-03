/* eslint-disable no-console */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config';
import { CoinDCXWs } from '../gateways/coindcx-ws';
import { createLogger } from '../logging/logger';
import { MicrostructureRecorder } from '../marketdata/replay/microstructure-recorder';
import { toCoinDcxFuturesInstrument } from '../utils/format';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1] ?? '';
    out[key] = value;
    index += 1;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const logger = await createLogger({
    logDir: cfg.LOG_DIR,
    level: cfg.LOG_LEVEL,
    rotateMb: cfg.LOG_FILE_ROTATE_MB,
    keep: cfg.LOG_FILE_KEEP,
    enableStdout: true,
  });

  const outputDir = args.outDir ?? join(cfg.BACKTEST_OUTPUT_DIR, 'microstructure');
  mkdirSync(outputDir, { recursive: true });
  const durationDays = Number(args.days ?? '30');
  const durationMs = Math.max(1, Math.floor(durationDays * 24 * 60 * 60_000));
  const pairSet = new Set((args.pairs ?? cfg.COINDCX_PAIRS.join(',')).split(',').map((item) => item.trim()).filter(Boolean));
  const pairs = [...pairSet.values()];
  const recorderByPair = new Map(
    pairs.map((pair) => {
      const normalizedPair = toCoinDcxFuturesInstrument(pair);
      const recorder = new MicrostructureRecorder({
        outDir: join(outputDir, sanitizePair(normalizedPair)),
        pair: normalizedPair,
        channels: ['depth-snapshot', 'depth-update', 'new-trade'],
        flushMs: cfg.BACKTEST_RECORDER_FLUSH_MS,
        rotateMb: cfg.BACKTEST_RECORDER_ROTATE_MB,
        compress: cfg.BACKTEST_RECORDER_COMPRESS,
      });
      recorder.start();
      return [sanitizePair(normalizedPair), recorder] as const;
    }),
  );
  const ws = new CoinDCXWs();
  let shuttingDown = false;

  const recordByPair = (channel: 'depth-snapshot' | 'depth-update' | 'new-trade', raw: unknown): void => {
    const eventPair = extractPair(raw);
    if (eventPair) {
      void recorderByPair.get(sanitizePair(eventPair))?.record(channel, raw);
      return;
    }
    if (recorderByPair.size === 1) {
      const fallback = recorderByPair.values().next().value as MicrostructureRecorder | undefined;
      if (fallback) void fallback.record(channel, raw);
    }
  };
  const onDepthSnapshot = (raw: unknown) => recordByPair('depth-snapshot', raw);
  const onDepthUpdate = (raw: unknown) => recordByPair('depth-update', raw);
  const onTrade = (raw: unknown) => recordByPair('new-trade', raw);
  ws.on('depth-snapshot', onDepthSnapshot);
  ws.on('depth-update', onDepthUpdate);
  ws.on('new-trade', onTrade);

  for (const pair of pairs) {
    ws.subscribePair(toCoinDcxFuturesInstrument(pair));
  }
  ws.connect();

  logger.info(
    {
      mod: 'cli.microstructure_recorder',
      outputDir,
      durationMs,
      pairs: pairs.map((pair) => toCoinDcxFuturesInstrument(pair)),
    },
    'microstructure recorder started',
  );

  const shutdown = async (exitCode: number, reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(timeout);
    ws.off('depth-snapshot', onDepthSnapshot);
    ws.off('depth-update', onDepthUpdate);
    ws.off('new-trade', onTrade);
    ws.disconnect();
    const summaries = await Promise.all(
      [...recorderByPair.entries()].map(async ([pairKey, recorder]) => ({
        pair: pairKey,
        ...(await recorder.close()),
      })),
    );
    const totalFrames = summaries.reduce((acc, item) => acc + item.framesWritten, 0);
    const files = summaries.flatMap((item) => item.files);
    logger.info({ mod: 'cli.microstructure_recorder', reason }, 'microstructure recorder stopped');
    logger.info(
      {
        mod: 'cli.microstructure_recorder',
        reason,
        framesWritten: totalFrames,
        files,
        byPair: summaries,
      },
      'microstructure recorder artifact summary',
    );
    logger.flush();
    process.exit(exitCode);
  };

  const timeout = setTimeout(() => {
    void shutdown(0, 'duration reached');
  }, durationMs);
  process.on('SIGINT', () => void shutdown(0, 'sigint'));
  process.on('SIGTERM', () => void shutdown(0, 'sigterm'));
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[microstructure-recorder] fatal:', error);
  process.exit(1);
});

function extractPair(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const pair = row.s ?? row.pair;
  if (typeof pair !== 'string' || pair.trim().length === 0) return undefined;
  return toCoinDcxFuturesInstrument(pair);
}

function sanitizePair(pair: string): string {
  return pair.trim().toUpperCase();
}
