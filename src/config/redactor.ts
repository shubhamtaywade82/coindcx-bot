const SENSITIVE = /(secret|token|key|password)/i;

const SENSITIVE_NAMES = [
  'secret', 'token', 'key', 'password',
  'apiKey', 'apiSecret', 'accessToken', 'refreshToken',
  'COINDCX_API_KEY', 'COINDCX_API_SECRET',
  'TELEGRAM_BOT_TOKEN', 'PG_URL',
];

export const REDACT_KEYS: string[] = [
  ...SENSITIVE_NAMES,
  ...SENSITIVE_NAMES.map((n) => `*.${n}`),
];

export function redact<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '***' : redact(v as unknown);
  }
  return out as T;
}
