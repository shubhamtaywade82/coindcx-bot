export interface TokenBucketOptions {
  capacity: number;
  refillPerSec: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly nowFn: () => number;

  constructor(private readonly opts: TokenBucketOptions) {
    this.tokens = opts.capacity;
    this.nowFn = opts.now ?? Date.now;
    this.lastRefill = this.nowFn();
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = this.opts.refillPerSec > 0
        ? Math.ceil(1000 / this.opts.refillPerSec)
        : 50;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  private refill(): void {
    const t = this.nowFn();
    const elapsed = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.opts.capacity, this.tokens + elapsed * this.opts.refillPerSec);
    this.lastRefill = t;
  }
}
