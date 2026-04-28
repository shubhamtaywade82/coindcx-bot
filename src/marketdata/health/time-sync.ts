export interface SkewEvent {
  severity: 'warn' | 'critical';
  localVsExchange: number | null;
  localVsNtp: number | null;
  exchangeVsNtp: number | null;
  reason: string;
}

export interface TimeSyncOptions {
  thresholdMs: number;
  fetchExchangeMs: () => Promise<number>;
  fetchNtpMs: () => Promise<number>;
  now?: () => number;
  onSkew: (e: SkewEvent) => void;
}

export class TimeSync {
  private nowFn: () => number;

  constructor(private readonly opts: TimeSyncOptions) {
    this.nowFn = opts.now ?? Date.now;
  }

  async checkOnce(): Promise<void> {
    const local = this.nowFn();
    const [exRes, ntpRes] = await Promise.allSettled([
      this.opts.fetchExchangeMs(),
      this.opts.fetchNtpMs(),
    ]);
    const exMs = exRes.status === 'fulfilled' ? exRes.value : null;
    const ntpMs = ntpRes.status === 'fulfilled' ? ntpRes.value : null;

    const localVsExchange = exMs !== null ? local - exMs : null;
    const localVsNtp      = ntpMs !== null ? local - ntpMs : null;
    const exchangeVsNtp   = exMs !== null && ntpMs !== null ? exMs - ntpMs : null;

    if (exMs === null || ntpMs === null) {
      this.opts.onSkew({
        severity: 'warn',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: exMs === null ? 'exchange_unavailable' : 'ntp_unavailable',
      });
      return;
    }
    const worst = Math.max(
      Math.abs(localVsExchange ?? 0),
      Math.abs(localVsNtp ?? 0),
      Math.abs(exchangeVsNtp ?? 0),
    );
    if (worst > this.opts.thresholdMs) {
      this.opts.onSkew({
        severity: 'critical',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: 'skew_exceeded',
      });
    }
  }
}
