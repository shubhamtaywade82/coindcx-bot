import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../src/config/schema';

const validEnv = {
  PG_URL: 'postgres://u:p@localhost:5432/db',
  COINDCX_API_KEY: 'k',
  COINDCX_API_SECRET: 's',
  LOG_DIR: '/tmp/logs',
  TELEGRAM_BOT_TOKEN: 't',
  TELEGRAM_CHAT_ID: '123',
};

describe('ConfigSchema', () => {
  it('parses valid env with defaults', () => {
    const cfg = ConfigSchema.parse(validEnv);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.LOG_FILE_ROTATE_MB).toBe(50);
    expect(cfg.SIGNAL_SINKS).toEqual(['stdout', 'file']);
    expect(cfg.SHUTDOWN_GRACE_MS).toBe(5000);
    expect(cfg.AUDIT_BUFFER_MAX).toBe(10000);
  });

  it('rejects missing required field', () => {
    const { PG_URL: _omit, ...rest } = validEnv;
    expect(() => ConfigSchema.parse(rest)).toThrow();
  });

  it('parses SIGNAL_SINKS as comma list', () => {
    const cfg = ConfigSchema.parse({ ...validEnv, SIGNAL_SINKS: 'stdout,file' });
    expect(cfg.SIGNAL_SINKS).toEqual(['stdout', 'file']);
  });

  it('rejects unknown sink names', () => {
    expect(() =>
      ConfigSchema.parse({ ...validEnv, SIGNAL_SINKS: 'stdout,bogus' }),
    ).toThrow();
  });
});

describe('F4 strategy config defaults', () => {
  it('parses with F4 defaults', () => {
    const cfg = ConfigSchema.parse(validEnv);
    expect(cfg.STRATEGY_TIMEOUT_MS).toBe(5000);
    expect(cfg.STRATEGY_ERROR_THRESHOLD).toBe(3);
    expect(cfg.STRATEGY_EMIT_WAIT).toBe(false);
    expect(cfg.STRATEGY_INTERVAL_DEFAULT_MS).toBe(15000);
    expect(cfg.STRATEGY_BACKPRESSURE_DROP_RATIO_ALARM).toBe(0.5);
    expect(cfg.BACKTEST_PESSIMISTIC).toBe(true);
    expect(cfg.STRATEGY_ENABLED_IDS).toEqual(['smc.rule.v1','ma.cross.v1','llm.pulse.v1']);
  });
});

describe('COINDCX_PAIRS normalization', () => {
  it('normalizes shorthand symbols to B-*_USDT wire ids', () => {
    const cfg = ConfigSchema.parse({
      ...validEnv,
      COINDCX_PAIRS: 'SOLUSDT,B-ETH_USDT',
    });
    expect(cfg.COINDCX_PAIRS).toEqual(['B-SOL_USDT', 'B-ETH_USDT']);
  });
});

describe('F3 account config defaults', () => {
  it('parses with F3 defaults', () => {
    const cfg = ConfigSchema.parse(validEnv);
    expect(cfg.ACCOUNT_DRIFT_SWEEP_MS).toBe(300_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_POSITION_MS).toBe(60_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_BALANCE_MS).toBe(60_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_ORDER_MS).toBe(30_000);
    expect(cfg.ACCOUNT_HEARTBEAT_FLOOR_FILL_MS).toBe(30_000);
    expect(cfg.ACCOUNT_PNL_ALARM_PCT).toBe(-0.10);
    expect(cfg.ACCOUNT_UTIL_ALARM_PCT).toBe(0.90);
    expect(cfg.ACCOUNT_DIVERGENCE_PNL_ABS_INR).toBe(100);
    expect(cfg.ACCOUNT_DIVERGENCE_PNL_PCT).toBe(0.01);
    expect(cfg.ACCOUNT_BACKFILL_HOURS).toBe(24);
    expect(cfg.ACCOUNT_SIGNAL_COOLDOWN_MS).toBe(300_000);
    expect(cfg.ACCOUNT_STORM_THRESHOLD).toBe(20);
    expect(cfg.ACCOUNT_STORM_WINDOW_MS).toBe(60_000);
  });
});
