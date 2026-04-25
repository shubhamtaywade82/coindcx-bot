import pino, { type Logger } from 'pino';
import pinoRoll from 'pino-roll';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REDACT_KEYS } from '../config/redactor';

export interface LoggerOptions {
  logDir: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  rotateMb: number;
  keep: number;
  enableStdout?: boolean;
}

export type AppLogger = Logger;

export async function createLogger(opts: LoggerOptions): Promise<AppLogger> {
  mkdirSync(opts.logDir, { recursive: true });

  const fileStream = await pinoRoll({
    file: join(opts.logDir, 'bot'),
    frequency: 'daily',
    size: `${opts.rotateMb}m`,
    limit: { count: opts.keep },
    extension: '.log',
  });

  const streams: pino.StreamEntry[] = [
    { level: opts.level, stream: fileStream as NodeJS.WritableStream },
  ];

  if (opts.enableStdout) {
    streams.push({ level: opts.level, stream: process.stdout });
  }

  return pino(
    {
      level: opts.level,
      base: { pid: process.pid },
      redact: { paths: REDACT_KEYS, censor: '***' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
}
