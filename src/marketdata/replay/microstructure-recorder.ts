import { createWriteStream, mkdirSync, statSync, existsSync, createReadStream, unlinkSync } from 'node:fs';
import type { ReadStream, WriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { toCoinDcxFuturesInstrument } from '../../utils/format';

export interface MicrostructureRecorderOptions {
  outDir: string;
  pair: string;
  channels: string[];
  flushMs: number;
  rotateMb: number;
  compress: boolean;
}

interface RecorderFrame {
  ts: number;
  pair: string;
  channel: string;
  raw: unknown;
}

export class MicrostructureRecorder {
  private stream: WriteStream;
  private bytesWritten = 0;
  private framesWritten = 0;
  private finalized = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly startedAtIso = new Date().toISOString();
  private readonly safePair: string;
  private currentFilePath: string;
  private fileIndex = 0;
  private readonly finalizedFiles: string[] = [];

  constructor(private readonly options: MicrostructureRecorderOptions) {
    mkdirSync(options.outDir, { recursive: true });
    this.safePair = sanitizeFileToken(options.pair);
    this.currentFilePath = this.buildActiveFilePath();
    this.stream = createWriteStream(this.currentFilePath, { flags: 'a' });
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.stream.write('');
    }, this.options.flushMs);
  }

  async stop(): Promise<void> {
    await this.close();
  }

  async close(): Promise<{ framesWritten: number; files: string[] }> {
    if (this.finalized) {
      return {
        framesWritten: this.framesWritten,
        files: this.finalizedFiles.slice(),
      };
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.finalizeCurrentFile();
    this.finalized = true;
    return {
      framesWritten: this.framesWritten,
      files: this.finalizedFiles.slice(),
    };
  }

  async record(channel: string, raw: unknown): Promise<void> {
    if (!this.options.channels.includes(channel)) return;
    const rawPair = extractPair(raw);
    if (rawPair && rawPair !== toCoinDcxFuturesInstrument(this.options.pair)) return;
    const line = JSON.stringify({
      ts: Date.now(),
      pair: rawPair ?? this.options.pair,
      channel,
      raw,
    } satisfies RecorderFrame) + '\n';
    this.stream.write(line);
    this.bytesWritten += Buffer.byteLength(line, 'utf8');
    this.framesWritten += 1;
    if (this.bytesWritten < this.options.rotateMb * 1024 * 1024) return;
    await this.rotateFile();
  }

  private async rotateFile(): Promise<void> {
    await this.finalizeCurrentFile();
    this.fileIndex += 1;
    this.bytesWritten = 0;
    this.currentFilePath = this.buildActiveFilePath();
    this.stream = createWriteStream(this.currentFilePath, { flags: 'a' });
  }

  private buildActiveFilePath(): string {
    const index = this.fileIndex.toString().padStart(4, '0');
    return join(
      this.options.outDir,
      `microstructure-${this.safePair}-${sanitizeFileToken(this.startedAtIso)}-${index}.jsonl`,
    );
  }

  private async finalizeCurrentFile(): Promise<void> {
    const filePath = this.currentFilePath;
    if (!this.stream.writableEnded) {
      await endStream(this.stream);
    }
    const finalized = this.options.compress
      ? await this.compressIfNeeded(filePath)
      : filePath;
    if (finalized) this.finalizedFiles.push(finalized);
  }

  private async compressIfNeeded(filePath: string): Promise<string | null> {
    if (!existsSync(filePath)) return null;
    const stats = statSync(filePath);
    if (stats.size === 0) {
      unlinkSync(filePath);
      return null;
    }
    const gzPath = `${filePath}.gz`;
    if (existsSync(gzPath)) return gzPath;
    const source: ReadStream = createReadStream(filePath);
    const gzip = createGzip();
    const sink: WriteStream = createWriteStream(gzPath, { flags: 'w' });
    await pipeline(source, gzip, sink);
    unlinkSync(filePath);
    return gzPath;
  }
}

function sanitizeFileToken(input: string): string {
  return input.replace(/[^A-Za-z0-9_-]/g, '_');
}

function extractPair(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const value = record.pair ?? record.s;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return toCoinDcxFuturesInstrument(value);
}

async function endStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
