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

    if (exMs === null) {
      this.opts.onSkew({
        severity: 'warn',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: 'exchange_unavailable',
      });
      return;
    }

    if (ntpMs === null) {
      const localSkewVsExchange = Math.abs(localVsExchange ?? 0);
      if (localSkewVsExchange > this.opts.thresholdMs) {
        this.opts.onSkew({
          severity: 'critical',
          localVsExchange, localVsNtp, exchangeVsNtp,
          reason: 'skew_exceeded',
        });
        return;
      }
      this.opts.onSkew({
        severity: 'warn',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: 'ntp_unavailable',
      });
      return;
    }

    // Only local clock vs exchange / NTP matters for signing; exchange↔NTP offset is not host skew.
    const worstLocal = Math.min(
      Math.abs(localVsExchange ?? 0),
      Math.abs(localVsNtp ?? 0),
    );
    if (worstLocal > this.opts.thresholdMs) {
      this.opts.onSkew({
        severity: 'critical',
        localVsExchange, localVsNtp, exchangeVsNtp,
        reason: 'skew_exceeded',
      });
    }
  }
}
