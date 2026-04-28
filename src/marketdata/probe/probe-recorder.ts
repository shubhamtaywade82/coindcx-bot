import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

export interface ProbeRecorderOptions {
  dir: string;
  pair: string;
  channels: string[];
  durationMs: number;
}

export class ProbeRecorder {
  private stream: WriteStream;
  private started = Date.now();
  private timer?: NodeJS.Timeout;

  constructor(private readonly opts: ProbeRecorderOptions) {
    mkdirSync(opts.dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safePair = opts.pair.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.stream = createWriteStream(
      join(opts.dir, `probe-${safePair}-${ts}.jsonl`),
      { flags: 'a' },
    );
  }

  record(channel: string, raw: unknown): void {
    if (!this.opts.channels.includes(channel)) return;
    this.stream.write(JSON.stringify({ ts: Date.now(), channel, raw }) + '\n');
  }

  scheduleStop(onStop: () => void): void {
    this.timer = setTimeout(() => {
      this.stream.end(() => onStop());
    }, this.opts.durationMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.stream.end();
  }

  elapsedMs(): number {
    return Date.now() - this.started;
  }
}
