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
  /** Per-(strategy,type,pair) cooldown for noisy signals. Map of typePrefix → ms. */
  cooldownMs?: Record<string, number>;
}

const DEFAULT_RETRIES = [250, 1000, 4000];

/** Recurring infrastructure events: send the first, swallow subsequent until cooldown elapses. */
const DEFAULT_COOLDOWNS: Record<string, number> = {
  'catalog.stale': 30 * 60_000,
  'catalog.refresh_failed': 30 * 60_000,
  'clock_skew': 30 * 60_000,
  'book_resync': 15 * 60_000,
  'book_resync_failed': 15 * 60_000,
  'stalefeed': 15 * 60_000,
  'reconcile.': 15 * 60_000,
  'strategy.error': 30 * 60_000,
};

function cooldownKey(s: Signal): string {
  const t = s.type || 'unknown';
  return `${s.strategy ?? ''}|${t}|${s.pair ?? ''}`;
}

function cooldownForType(type: string, table: Record<string, number>): number | null {
  if (table[type] !== undefined) return table[type];
  for (const key of Object.keys(table)) {
    if (key.endsWith('.') && type.startsWith(key)) return table[key];
  }
  return null;
}

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
  private readonly cooldowns: Record<string, number>;
  private readonly cooldownExpiry = new Map<string, number>();

  constructor(private readonly opts: TelegramSinkOptions) {
    this.bucket = new TokenBucket({
      capacity: opts.ratePerMin,
      refillPerSec: opts.ratePerMin / 60,
    });
    this.cooldowns = { ...DEFAULT_COOLDOWNS, ...(opts.cooldownMs ?? {}) };
    this.http = opts.http ?? axios.create({ baseURL: 'https://api.telegram.org', timeout: 10_000 });
    this.retries = opts.retryDelaysMs ?? DEFAULT_RETRIES;
  }

  async emit(signal: Signal): Promise<void> {
    const type = signal.type || 'unknown';

    // Only skip explicit strategy WAIT (LLM / rules). Do not infer from `type.split('.')`:
    // Pine/webhook use types like `long`, `alert`, `whale_buy` with no dot — those were wrongly dropped.
    if (type === 'strategy.wait') return;

    // ntp_unavailable is expected on networks that block UDP 123 — not actionable.
    if (type === 'clock_skew' && (signal.payload as any)?.reason === 'ntp_unavailable') return;
    // strategy.error: keep out of Telegram. Errors land in file/stdout sinks + signal_log + TUI.
    if (type === 'strategy.error') return;

    const cooldownMs = cooldownForType(type, this.cooldowns);
    if (cooldownMs !== null) {
      const ck = cooldownKey(signal);
      const now = Date.now();
      const exp = this.cooldownExpiry.get(ck) ?? 0;
      if (now < exp) return;
      this.cooldownExpiry.set(ck, now + cooldownMs);
    }

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
