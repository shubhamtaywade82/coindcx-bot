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
  const type = s.type || 'unknown';
  const payload = s.payload as any || {};
  const pair = s.pair ? s.pair.replace('_', '\\_') : '—'; // Escape underscore for Markdown
  const side = (type.split('.')[1] || 'WAIT').toUpperCase();

  let icon = s.severity === 'critical' ? '🔴' : s.severity === 'warn' ? '🟡' : '🟢';
  let title = `*${s.strategy.toUpperCase()}*`;
  let msg = '';

  if (type.startsWith('strategy.')) {
    if (type.includes('error')) {
      icon = '🔴';
      msg = `ERROR: ${payload.error || payload.reason || 'Unknown error'}`;
    } else {
      icon = side === 'LONG' ? '🟢' : '🔴';
      const entry = payload.entry ? ` @ \`${payload.entry}\`` : '';
      const tp = payload.takeProfit ? ` | TP: \`${payload.takeProfit}\`` : '';
      const sl = payload.stopLoss ? ` | SL: \`${payload.stopLoss}\`` : '';
      const conf = payload.confidence ? `\n🔥 Confidence: \`${(payload.confidence * 100).toFixed(0)}%\`` : '';
      const rr = payload.meta?.rr ? ` | R:R: \`${Number(payload.meta.rr).toFixed(2)}\`` : '';
      const mgmt = payload.meta?.management ? `\n\n🛡️ *Management:* ${payload.meta.management}` : '';
      
      msg = `*${side} ${pair}*${entry}${rr}${tp}${sl}${conf}\n\n*Verdict:* ${payload.reason || 'No reasoning provided.'}${mgmt}`;
    }
  } else if (type === 'risk.blocked') {
    icon = '🟡';
    const rules = Array.isArray(payload.rules) ? payload.rules.map((r: any) => r.id).join(', ') : 'unknown';
    msg = `*RISK BLOCKED* ${side} ${pair}\nRule: \`${rules}\``;
  } else if (type.includes('reconcile')) {
    if (s.severity !== 'critical') return '';
    icon = '🔴';
    msg = `*ACCOUNT ALERT*\n${payload.reason || ''}`;
  } else if (s.strategy === 'integrity' || type === 'clock_skew') {
    if (s.severity === 'info') return '';
    icon = s.severity === 'critical' ? '🔴' : '🟡';
    const label = s.severity === 'critical' ? 'INTEGRITY ALERT' : 'INTEGRITY WARN';
    msg = `*${label}*\n${type.toUpperCase()}${pair !== '—' ? ` ${pair}` : ''}: ${payload.reason || payload.error || JSON.stringify(payload).slice(0, 200)}`;
  } else {
    // Fallback for unknown types if they made it past the filter
    return `${icon} ${title} / \`${type}\` ${pair}\n\`\`\`\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  }

  return `${icon} ${title} / ${msg}`;
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
    const type = signal.type || 'unknown';
    const side = (type.split('.')[1] || 'WAIT').toUpperCase();

    // Filter out WAIT signals to reduce noise (unless it's an error)
    if (side === 'WAIT' && !type.includes('error')) return;

    const text = fmt(signal);
    if (!text) return;

    await this.bucket.take();
    const url = `/bot${this.opts.token}/sendMessage`;
    const body = { chat_id: this.opts.chatId, text, parse_mode: 'Markdown' };

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
