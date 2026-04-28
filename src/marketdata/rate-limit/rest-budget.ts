export interface RestBudgetOptions {
  globalPerMin: number;
  pairPerMin: number;
  timeoutMs: number;
  now?: () => number;
}

interface Bucket { tokens: number; cap: number; refillPerSec: number; last: number; }

export class RestBudgetExhausted extends Error {
  constructor(public readonly pair: string) {
    super(`Rest budget exhausted for ${pair}`);
    this.name = 'RestBudgetExhausted';
  }
}

export class RestBudget {
  private global: Bucket;
  private perPair = new Map<string, Bucket>();
  private nowFn: () => number;

  constructor(private readonly opts: RestBudgetOptions) {
    this.nowFn = opts.now ?? Date.now;
    this.global = this.makeBucket(opts.globalPerMin);
  }

  private makeBucket(perMin: number): Bucket {
    return {
      tokens: perMin,
      cap: perMin,
      refillPerSec: perMin / 60,
      last: this.nowFn(),
    };
  }

  private refill(b: Bucket): void {
    const t = this.nowFn();
    const elapsed = (t - b.last) / 1000;
    b.tokens = Math.min(b.cap, b.tokens + elapsed * b.refillPerSec);
    b.last = t;
  }

  async acquire(pair: string): Promise<void> {
    const deadline = Date.now() + this.opts.timeoutMs;
    while (true) {
      let pb = this.perPair.get(pair);
      if (!pb) { pb = this.makeBucket(this.opts.pairPerMin); this.perPair.set(pair, pb); }
      this.refill(this.global);
      this.refill(pb);
      if (this.global.tokens >= 1 && pb.tokens >= 1) {
        this.global.tokens -= 1;
        pb.tokens -= 1;
        return;
      }
      if (Date.now() >= deadline) throw new RestBudgetExhausted(pair);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
