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
