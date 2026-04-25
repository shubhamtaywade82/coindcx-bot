import { describe, it, expect } from 'vitest';
import { redact, REDACT_KEYS } from '../../src/config/redactor';

describe('redactor', () => {
  it('replaces values for sensitive keys', () => {
    const out = redact({ apiKey: 'abc', password: 'p', nested: { token: 't', ok: 'fine' } });
    expect(out.apiKey).toBe('***');
    expect(out.password).toBe('***');
    expect((out.nested as any).token).toBe('***');
    expect((out.nested as any).ok).toBe('fine');
  });

  it('leaves non-sensitive keys', () => {
    const out = redact({ name: 'alice', count: 3 });
    expect(out).toEqual({ name: 'alice', count: 3 });
  });

  it('exposes pino-compatible key list', () => {
    expect(REDACT_KEYS).toContain('*.token');
    expect(REDACT_KEYS).toContain('*.secret');
  });
});
