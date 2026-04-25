import { z } from 'zod';

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
