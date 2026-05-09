import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
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
  /** Optional path for persisting cooldown state across restarts (recommended for unstable processes). */
  cooldownStatePath?: string;
}

const DEFAULT_RETRIES = [250, 1000, 4000];

/** Strategies whose `strategy.wait` payloads should still ship to Telegram (AI pulse / conductor). */
const ALWAYS_DELIVER_WAIT_STRATEGIES = new Set<string>([
  'llm.pulse.v1',
  'ai.conductor.v1',
]);

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
  // AI WAIT updates: cooldown so traders see the latest read every few minutes, not every bar.
  'strategy.wait': 5 * 60_000,
};

/** Cooldown keys that should never persist across restarts (volatile, regenerate quickly). */
const VOLATILE_COOLDOWN_TYPES = new Set<string>(['strategy.wait']);

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

/** Appends when strategies attach fusion liquidity raid meta (e.g. bearish.smc / smc.rule). */
function liquidityRaidTelegramLine(meta: unknown): string {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
  const m = meta as Record<string, unknown>;
  const score =
    typeof m.liquidityRaidScore === 'number' && Number.isFinite(m.liquidityRaidScore)
      ? m.liquidityRaidScore
      : undefined;
  const contrib =
    typeof m.liquidityRaidContribution === 'number' && Number.isFinite(m.liquidityRaidContribution)
      ? m.liquidityRaidContribution
      : undefined;
  if (score === undefined && contrib === undefined) return '';
  const bits: string[] = [];
  if (m.postSweep === true) bits.push('sweep context');
  if (score !== undefined) bits.push(`raid score \`${Number(score).toFixed(1)}\``);
  if (contrib !== undefined) {
    const c = Number(contrib);
    const sign = c > 0 ? '+' : '';
    bits.push(`flow \`${sign}${c.toFixed(2)}\``);
  }
  return `\n💧 *Liquidity:* ${bits.join(' · ')}`;
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
      icon = side === 'LONG' ? '🟢' : side === 'SHORT' ? '🔴' : '🟡';
      const entry = payload.entry ? ` @ \`${payload.entry}\`` : '';
      const tp = payload.takeProfit ? ` | TP: \`${payload.takeProfit}\`` : '';
      const sl = payload.stopLoss ? ` | SL: \`${payload.stopLoss}\`` : '';
      const conf = typeof payload.confidence === 'number'
        ? `\n🔥 Confidence: \`${(payload.confidence * 100).toFixed(0)}%\``
        : '';
      const rr = payload.meta?.rr ? ` | R:R: \`${Number(payload.meta.rr).toFixed(2)}\`` : '';
      const mgmt = payload.meta?.management ? `\n\n🛡️ *Management:* ${payload.meta.management}` : '';
      const cb = payload.meta?.currentBias ? String(payload.meta.currentBias).toUpperCase() : '';
      const nb = payload.meta?.expectedNextBias ? String(payload.meta.expectedNextBias).toUpperCase() : '';
      const trig = payload.meta?.biasTrigger ? String(payload.meta.biasTrigger) : '';
      const biasLine = (cb || nb)
        ? `\n🧭 *Bias:* ${cb || '—'} → ${nb || '—'}${trig ? `\n   _Trigger:_ ${trig}` : ''}`
        : '';
      const chosen = payload.meta?.chosen_strategy ? `\n🎯 *Chosen:* \`${String(payload.meta.chosen_strategy)}\`` : '';
      const raidLine = liquidityRaidTelegramLine(payload.meta);

      msg = `*${side} ${pair}*${entry}${rr}${tp}${sl}${conf}${biasLine}${chosen}${raidLine}\n\n*Verdict:* ${payload.reason || 'No reasoning provided.'}${mgmt}`;
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
  private readonly cooldownStatePath?: string;
  private cooldownPersistTimer?: NodeJS.Timeout;

  constructor(private readonly opts: TelegramSinkOptions) {
    this.bucket = new TokenBucket({
      capacity: opts.ratePerMin,
      refillPerSec: opts.ratePerMin / 60,
    });
    this.cooldowns = { ...DEFAULT_COOLDOWNS, ...(opts.cooldownMs ?? {}) };
    this.http = opts.http ?? axios.create({ baseURL: 'https://api.telegram.org', timeout: 10_000 });
    this.retries = opts.retryDelaysMs ?? DEFAULT_RETRIES;
    this.cooldownStatePath = opts.cooldownStatePath;
    this.loadCooldownState();
  }

  private loadCooldownState(): void {
    if (!this.cooldownStatePath) return;
    try {
      if (!fs.existsSync(this.cooldownStatePath)) return;
      const raw = fs.readFileSync(this.cooldownStatePath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'number' || v <= now) continue;
        const type = k.split('|')[1] ?? '';
        if (VOLATILE_COOLDOWN_TYPES.has(type)) continue; // never honor persisted volatile cooldowns
        this.cooldownExpiry.set(k, v);
      }
    } catch {
      // ignore corrupt state file; cooldown resets are not safety-critical.
    }
  }

  private scheduleCooldownPersist(): void {
    if (!this.cooldownStatePath) return;
    if (this.cooldownPersistTimer) return;
    this.cooldownPersistTimer = setTimeout(() => {
      this.cooldownPersistTimer = undefined;
      try {
        const dir = path.dirname(this.cooldownStatePath!);
        fs.mkdirSync(dir, { recursive: true });
        const obj: Record<string, number> = {};
        const now = Date.now();
        for (const [k, v] of this.cooldownExpiry) {
          if (v <= now) continue;
          // Key format: "strategy|type|pair" — skip volatile types from disk so a restart
          // does not silence fresh AI pulses behind stale expiries.
          const parts = k.split('|');
          const type = parts[1] ?? '';
          if (VOLATILE_COOLDOWN_TYPES.has(type)) continue;
          obj[k] = v;
        }
        fs.writeFileSync(this.cooldownStatePath!, JSON.stringify(obj));
      } catch {
        // best-effort persist; loss only re-fires alerts after restart.
      }
    }, 250);
  }

  async emit(signal: Signal): Promise<void> {
    const type = signal.type || 'unknown';

    // strategy.wait is normally noise; allow only for AI pulse + conductor so traders see live verdicts.
    if (type === 'strategy.wait' && !ALWAYS_DELIVER_WAIT_STRATEGIES.has(signal.strategy ?? '')) return;

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
      this.scheduleCooldownPersist();
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
