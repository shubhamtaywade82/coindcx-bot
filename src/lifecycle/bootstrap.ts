import { loadConfig } from '../config';
import { ollamaHostRequiresApiKey } from '../ai/ollama-host';
import { createLogger } from '../logging/logger';
import { getPool } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { Audit } from '../audit/audit';
import { SignalBus } from '../signals/bus';
import { Cursors } from '../resume/cursors';
import { FileSink } from '../sinks/file-sink';
import { TelegramSink } from '../sinks/telegram-sink';
import type { Sink } from '../sinks/types';
import type { Context } from './context';
import { MarketCatalog } from '../marketdata/market-catalog';
import { CoreRuntimePipeline } from '../runtime/runtime-pipeline';

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

    logger.info(
      {
        mod: 'boot',
        ollama: config.OLLAMA_URL,
        model: config.OLLAMA_MODEL,
        ollamaAuth: config.OLLAMA_API_KEY?.trim() ? 'bearer' : 'none',
      },
      'boot start',
    );

  if (ollamaHostRequiresApiKey(config.OLLAMA_URL) && !config.OLLAMA_API_KEY?.trim()) {
    logger.warn(
      { mod: 'boot' },
      'OLLAMA_URL is Ollama Cloud but OLLAMA_API_KEY is empty — AI Strategy Pulse will not work until you set a key (https://ollama.com/settings/keys)',
    );
  }

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
    onError: (err, depth) => logger.warn({ mod: 'audit', err: err.message, depth }, 'audit drain failed'),
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
      // Persist cooldown across restarts so an unstable process does not re-page on every boot.
      cooldownStatePath: `${config.LOG_DIR}/telegram-cooldown.json`,
      // Infra noise suppression: send the first occurrence, silence repeats for the cooldown window.
      cooldownMs: {
        'catalog.stale': 60 * 60_000,          // 1 h
        'catalog.refresh_failed': 30 * 60_000,  // 30 min
        'clock_skew': 60 * 60_000,              // 1 h
        'book_resync': 30 * 60_000,             // 30 min
        'book_resync_failed': 30 * 60_000,
        'stale_feed': 30 * 60_000,
        'heartbeat_lost': 5 * 60_000,
        'reconcile.': 15 * 60_000,
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
  const stateBuilder = new MarketStateBuilder(logger, pool);

  let webhook: import('../gateways/webhook').WebhookGateway | undefined;
  if (config.WEBHOOK_ENABLED) {
    const { WebhookGateway } = await import('../gateways/webhook');
    if (!config.WEBHOOK_SHARED_SECRET) {
      logger.warn({ mod: 'boot' }, 'WEBHOOK_ENABLED=true without WEBHOOK_SHARED_SECRET — endpoint unauthenticated; bound to localhost only');
    }
    webhook = new WebhookGateway({
      port: config.WEBHOOK_PORT,
      path: config.WEBHOOK_PATH,
      host: config.WEBHOOK_BIND_HOST,
      sharedSecret: config.WEBHOOK_SHARED_SECRET,
      bus,
      logger: logger.child({ mod: 'webhook' }),
    });
    webhook.start();
  }

  const marketCatalog = new MarketCatalog({
    pool,
    logger: logger.child({ mod: 'market-catalog' }),
    bus,
    refreshMs: 15 * 60_000,
    staleAlertMs: 60 * 60_000,
  });
  await marketCatalog.start();
  const runtime = new CoreRuntimePipeline();

  logger.info({ mod: 'boot', sinks: config.SIGNAL_SINKS, webhook: !!webhook }, 'boot complete');

  return {
    config,
    logger,
    pool,
    audit,
    bus,
    cursors,
    analyzer,
    stateBuilder,
    webhook,
    marketCatalog,
    runtime,
  };
}
