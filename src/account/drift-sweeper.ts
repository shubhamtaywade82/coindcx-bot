export interface DriftSweeperOptions {
  intervalMs: number;
  onSweep: () => Promise<void>;
  tryAcquire: () => Promise<boolean>;
}

export class DriftSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: DriftSweeperOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      const ok = await this.opts.tryAcquire();
      if (!ok) return;
      await this.opts.onSweep();
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
