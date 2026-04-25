import axios, { AxiosInstance } from 'axios';
import type { Sink } from './types';
import type { Signal } from '../signals/types';
import { TokenBucket } from './token-bucket';

export interface TelegramSinkOptions {
  token: string;
  chatId: string;
  ratePerMin: number;
  retryDelaysMs?: number[];
  onDrop?: (signal: Signal, err: Error) => void;
  http?: AxiosInstance;
}

const DEFAULT_RETRIES = [250, 1000, 4000];

function fmt(s: Signal): string {
  const sev = s.severity === 'critical' ? '🔴' : s.severity === 'warn' ? '🟡' : '🟢';
  const pair = s.pair ? ` *${s.pair}*` : '';
  const body = '```\n' + JSON.stringify(s.payload, null, 2) + '\n```';
  return `${sev} *${s.strategy}* / \`${s.type}\`${pair}\n${body}`;
}

export class TelegramSink implements Sink {
  readonly name = 'telegram';
  private readonly bucket: TokenBucket;
  private readonly http: AxiosInstance;
  private readonly retries: number[];

  constructor(private readonly opts: TelegramSinkOptions) {
    this.bucket = new TokenBucket({
      capacity: opts.ratePerMin,
      refillPerSec: opts.ratePerMin / 60,
    });
    this.http = opts.http ?? axios.create({ baseURL: 'https://api.telegram.org', timeout: 10_000 });
    this.retries = opts.retryDelaysMs ?? DEFAULT_RETRIES;
  }

  async emit(signal: Signal): Promise<void> {
    await this.bucket.take();
    const url = `/bot${this.opts.token}/sendMessage`;
    const body = { chat_id: this.opts.chatId, text: fmt(signal), parse_mode: 'Markdown' };

    let attempt = 0;
    let lastErr: Error | undefined;
    while (attempt <= this.retries.length) {
      try {
        await this.http.post(url, body);
        return;
      } catch (err) {
        lastErr = err as Error;
        const delay = this.retries[attempt];
        if (delay === undefined) break;
        await new Promise((r) => setTimeout(r, delay));
        attempt += 1;
      }
    }
    this.opts.onDrop?.(signal, lastErr ?? new Error('unknown telegram failure'));
  }
}
