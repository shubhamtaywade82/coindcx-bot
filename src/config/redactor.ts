const SENSITIVE = /(secret|token|key|password)/i;

export const REDACT_KEYS = [
  '*.secret', '*.token', '*.key', '*.password',
  'secret', 'token', 'key', 'password',
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
