import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { Sink } from './types';
import type { Signal } from '../signals/types';

export interface FileSinkOptions { dir: string; }

function dayKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

export class FileSink implements Sink {
  readonly name = 'file';
  private currentKey?: string;
  private stream?: WriteStream;

  constructor(private readonly opts: FileSinkOptions) {
    mkdirSync(opts.dir, { recursive: true });
  }

  async emit(signal: Signal): Promise<void> {
    const key = dayKey();
    if (key !== this.currentKey) {
      this.stream?.end();
      this.stream = createWriteStream(join(this.opts.dir, `signals-${key}.jsonl`), { flags: 'a' });
      this.currentKey = key;
    }
    const line = JSON.stringify(signal) + '\n';
    await new Promise<void>((resolve, reject) => {
      this.stream!.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.stream) return resolve();
      this.stream.end(resolve);
    });
  }
}
