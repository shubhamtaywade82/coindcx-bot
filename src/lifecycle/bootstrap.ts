import { loadConfig } from '../config';
import { createLogger } from '../logging/logger';
import { getPool } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { Audit } from '../audit/audit';
import { SignalBus } from '../signals/bus';
import { Cursors } from '../resume/cursors';
import { StdoutSink } from '../sinks/stdout-sink';
import { FileSink } from '../sinks/file-sink';
import { TelegramSink } from '../sinks/telegram-sink';
import type { Sink } from '../sinks/types';
import type { Context } from './context';

async function connectWithRetry<T>(fn: () => Promise<T>, attempts: number, baseMs: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const delay = baseMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function bootstrap(): Promise<Context> {
  const config = loadConfig();
  const logger = await createLogger({
    logDir: config.LOG_DIR,
    level: config.LOG_LEVEL,
    rotateMb: config.LOG_FILE_ROTATE_MB,
    keep: config.LOG_FILE_KEEP,
    enableStdout: false,
  });

  // Intercept all console calls to prevent TUI corruption
  const { interceptConsole } = await import('../logging/interceptor');
  interceptConsole(logger);

  logger.info({ mod: 'boot', ollama: config.OLLAMA_URL, model: config.OLLAMA_MODEL }, 'boot start');

  const pool = await connectWithRetry(async () => {
    const p = getPool();
    await p.query('SELECT 1');
    return p;
  }, 5, 1000);

  await runMigrations({ direction: 'up' });

  const cursors = new Cursors(pool);
  await cursors.load();

  const audit = new Audit({
    pool,
    bufferMax: config.AUDIT_BUFFER_MAX,
    onDrop: (n) => logger.warn({ mod: 'audit', dropped: n }, 'audit overflow'),
  });
  audit.start();

  const sinks: Sink[] = [];
  // if (config.SIGNAL_SINKS.includes('stdout')) sinks.push(new StdoutSink());
  if (config.SIGNAL_SINKS.includes('file')) sinks.push(new FileSink({ dir: config.LOG_DIR }));
  if (config.SIGNAL_SINKS.includes('telegram') && config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    sinks.push(new TelegramSink({
      token: config.TELEGRAM_BOT_TOKEN,
      chatId: config.TELEGRAM_CHAT_ID,
      ratePerMin: config.TELEGRAM_RATE_PER_MIN,
      onDrop: (s, err) => {
        logger.warn({ mod: 'telegram', sigId: s.id, err: err.message }, 'telegram drop');
        audit.recordEvent({ kind: 'telegram_drop', source: 'telegram', payload: { id: s.id, err: err.message } });
      },
    }));
  }

  const bus = new SignalBus({
    sinks,
    pool,
    onSinkError: (name, err) => logger.warn({ mod: 'bus', sink: name, err: err.message }, 'sink failed'),
    onPersistError: (err) => logger.warn({ mod: 'bus', err: err.message }, 'signal_log persist failed'),
  });

  audit.recordEvent({ kind: 'boot', source: 'lifecycle', payload: { sinks: config.SIGNAL_SINKS } });

  const { AiAnalyzer } = await import('../ai/analyzer');
  const { MarketStateBuilder } = await import('../ai/state-builder');
  const analyzer = new AiAnalyzer(config, logger);
  const stateBuilder = new MarketStateBuilder(logger);

  logger.info({ mod: 'boot', sinks: config.SIGNAL_SINKS }, 'boot complete');

  return { config, logger, pool, audit, bus, cursors, analyzer, stateBuilder };
}
