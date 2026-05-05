import { z } from 'zod';
import { toCoinDcxFuturesInstrument } from '../utils/format';

const SinkName = z.enum(['stdout', 'file', 'telegram']);

export const ConfigSchema = z.object({
  PG_URL: z.string().min(1),
  COINDCX_API_KEY: z.string().min(1),
  COINDCX_API_SECRET: z.string().min(1),
  LOG_DIR: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FILE_ROTATE_MB: z.coerce.number().int().positive().default(50),
  LOG_FILE_KEEP: z.coerce.number().int().positive().default(10),
  SIGNAL_SINKS: z
    .string()
    .default('stdout,file')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(SinkName)),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(5000),
  AUDIT_BUFFER_MAX: z.coerce.number().int().positive().default(10000),
  TELEGRAM_RATE_PER_MIN: z.coerce.number().int().positive().default(20),
  COINDCX_PAIRS: z.string()
    .default('B-BTC_USDT,B-ETH_USDT')
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean).map(toCoinDcxFuturesInstrument)),
  READ_ONLY: z.string().default('true').transform(s => s !== 'false'),
  API_BASE_URL: z.string().url().default('https://api.coindcx.com'),
  PUBLIC_BASE_URL: z.string().url().default('https://public.coindcx.com'),
  SOCKET_BASE_URL: z.string().url().default('wss://stream.coindcx.com'),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  /** Local: http://127.0.0.1:11434 — Ollama Cloud: https://ollama.com (see OLLAMA_API_KEY). */
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3'),
  /** When set, all Ollama HTTP requests include Authorization: Bearer … (required for https://ollama.com). */
  OLLAMA_API_KEY: z.string().default(''),
  WEBHOOK_ENABLED: z.string().default('false').transform(s => s === 'true'),
  WEBHOOK_PORT: z.coerce.number().int().positive().default(4003),
  WEBHOOK_PATH: z.string().default('/webhook/tradingview'),
  WEBHOOK_BIND_HOST: z.string().default('127.0.0.1'),
  WEBHOOK_SHARED_SECRET: z.string().optional(),

  // F2 Market Data Integrity
  RESYNC_WS_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  REST_BUDGET_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  REST_BUDGET_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(6),
  REST_BUDGET_PAIR_PER_MIN: z.coerce.number().int().positive().default(1),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(35000),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  STALE_FLOOR_currentPrices: z.coerce.number().int().positive().default(5000),
  STALE_FLOOR_newTrade: z.coerce.number().int().positive().default(30000),
  STALE_FLOOR_depthUpdate: z.coerce.number().int().positive().default(10000),
  CHECKSUM_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  REST_CHECKSUM_INTERVAL_MS: z.coerce.number().int().positive().default(600000),
  TIME_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
  SKEW_THRESHOLD_MS: z.coerce.number().int().positive().default(500),
  TAIL_BUFFER_SIZE: z.coerce.number().int().positive().default(1000),
  LATENCY_RESERVOIR: z.coerce.number().int().positive().default(4096),
  STALE_RESERVOIR: z.coerce.number().int().positive().default(1024),
  BOOK_INTEGRITY_MODE: z.enum(['heuristic', 'strict']).default('heuristic'),

  // F3 Account Reconciler
  ACCOUNT_DRIFT_SWEEP_MS: z.coerce.number().int().positive().default(300_000),
  ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS: z.coerce.number().int().positive().default(60_000),
  ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS: z.coerce.number().int().positive().default(60_000),
  ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS: z.coerce.number().int().positive().default(30_000),
  ACCOUNT_HEARTBEAT_FLOOR_FILL_MS: z.coerce.number().int().positive().default(30_000),
  ACCOUNT_PNL_ALARM_PCT: z.coerce.number().default(-0.10),
  ACCOUNT_UTIL_ALARM_PCT: z.coerce.number().default(0.90),
  ACCOUNT_DIVERGENCE_PNL_ABS_INR: z.coerce.number().default(100),
  ACCOUNT_DIVERGENCE_PNL_PCT: z.coerce.number().default(0.01),
  ACCOUNT_BACKFILL_HOURS: z.coerce.number().int().positive().default(24),
  ACCOUNT_SIGNAL_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  ACCOUNT_STORM_THRESHOLD: z.coerce.number().int().positive().default(20),
  ACCOUNT_STORM_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // F4 Strategy Framework
  STRATEGY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  STRATEGY_ERROR_THRESHOLD: z.coerce.number().int().positive().default(3),
  STRATEGY_EMIT_WAIT: z.string().default('false').transform(s => s === 'true'),
  STRATEGY_INTERVAL_DEFAULT_MS: z.coerce.number().int().positive().default(15000),
  STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM: z.coerce.number().default(0.5),
  STRATEGY_ENABLED_IDS: z.string().default('smc.rule.v1,ma.cross.v1,llm.pulse.v1,trendline.breakout.v1')
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  BACKTEST_PESSIMISTIC: z.string().default('true').transform(s => s !== 'false'),
  BACKTEST_OUTPUT_DIR: z.string().default('./logs/backtest'),
  BACKTEST_CANDLE_MAX_BARS_PER_CALL: z.coerce.number().int().positive().max(1000).default(1000),
  BACKTEST_CANDLE_DEFAULT_TIMEFRAMES: z.string().default('1m,15m,1h')
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  BACKTEST_RECORDER_FLUSH_MS: z.coerce.number().int().positive().default(5000),
  BACKTEST_RECORDER_ROTATE_MB: z.coerce.number().positive().default(128),
  BACKTEST_RECORDER_COMPRESS: z.string().default('true').transform(s => s !== 'false'),
  PAPER_GATE_MIN_RUN_DAYS: z.coerce.number().positive().default(30),
  PAPER_GATE_PROGRESS_EMIT_MS: z.coerce.number().int().positive().default(60_000),
  PAPER_GATE_MIN_BE_LOCK_BEFORE_STOP_RATE: z.coerce.number().positive().max(100).default(0.99),
  PAPER_GATE_MIN_EXPECTANCY_R: z.coerce.number().default(0.4),
  PAPER_GATE_MAX_DRAWDOWN_PCT: z.coerce.number().positive().max(100).default(0.08),

  // F5 Risk Alert Engine
  RISK_FILTER_MODE: z.enum(['passthrough', 'composite']).default('composite'),
  RISK_MAX_CONCURRENT_SIGNALS: z.coerce.number().int().nonnegative().default(3),
  RISK_MAX_PER_STRATEGY_POSITIONS: z.coerce.number().int().nonnegative().default(1),
  RISK_DRAWDOWN_GATE_PCT: z.coerce.number().default(0.10),
  RISK_PER_PAIR_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(60_000),
  RISK_CORRELATION_BLOCK_OPPOSING: z.string().default('true').transform(s => s !== 'false'),
  RISK_MIN_CONFIDENCE: z.coerce.number().default(0.5),
  RISK_ALERT_EMIT: z.string().default('true').transform(s => s !== 'false'),

  // B2 Worker / scheduler responsibilities
  WORKER_CANDLE_CLOSE_ENABLED: z.string().default('true').transform(s => s !== 'false'),
  WORKER_CANDLE_CLOSE_TIMEFRAMES: z.string().default('1m,15m,1h')
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  WORKER_CANDLE_CLOSE_TICK_MS: z.coerce.number().int().positive().default(1_000),
  WORKER_BREAKEVEN_ENABLED: z.string().default('true').transform(s => s !== 'false'),
  WORKER_BREAKEVEN_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  WORKER_BREAKEVEN_ARM_PCT: z.coerce.number().positive().default(0.003),
  WORKER_FUNDING_ENABLED: z.string().default('true').transform(s => s !== 'false'),
  WORKER_FUNDING_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WORKER_FUNDING_LEAD_MS: z.coerce.number().int().positive().default(300_000),
  WORKER_FUNDING_WINDOWS_UTC: z.string().default('04:00,12:00,20:00'),

  // B5 TradePlan / position risk
  TRADEPLAN_ACCOUNT_EQUITY: z.coerce.number().positive().default(10_000),
  TRADEPLAN_RISK_CAPITAL_FRACTION: z.coerce.number().positive().max(1).default(0.01),
  TRADEPLAN_ATR_BUFFER_MULTIPLIER: z.coerce.number().positive().default(1),
  TRADEPLAN_HARD_MAX_LEVERAGE: z.coerce.number().positive().default(10),
  TRADEPLAN_LIQUIDATION_BUFFER_MULTIPLIER: z.coerce.number().positive().default(2),
  TRADEPLAN_FEE_RATE: z.coerce.number().nonnegative().default(0.001),
  TRADEPLAN_FUNDING_RATE_BUFFER: z.coerce.number().nonnegative().default(0.0005),

  // B5 No-close-negative-PnL policy
  NEGATIVE_CLOSE_HC_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(85),
  NEGATIVE_CLOSE_TIME_STOP_MS: z.coerce.number().int().positive().default(3_600_000),
}).superRefine((data, _ctx) => {
  // If telegram is requested but credentials are missing, silently filter it out
  // to prevent startup crashes.
  if (data.SIGNAL_SINKS.includes('telegram')) {
    if (!data.TELEGRAM_BOT_TOKEN || !data.TELEGRAM_CHAT_ID) {
      data.SIGNAL_SINKS = data.SIGNAL_SINKS.filter(s => s !== 'telegram');
    }
  }
});

export type Config = z.infer<typeof ConfigSchema>;
