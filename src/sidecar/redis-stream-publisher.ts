import Redis from 'ioredis';
import type { SidecarEnvelope } from './event-normalizer';

export interface RedisStreamPublisherOptions {
  redisUrl: string;
  streamPrefix?: string;
}

function sanitizePair(pair?: string): string {
  if (!pair) return 'all';
  return pair.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

export class RedisStreamPublisher {
  private readonly redis: Redis;
  private readonly streamPrefix: string;

  constructor(private readonly opts: RedisStreamPublisherOptions) {
    this.redis = new Redis(opts.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.streamPrefix = opts.streamPrefix ?? 'sidecar';
  }

  async connect(): Promise<void> {
    if (this.redis.status === 'ready') return;
    await this.redis.connect();
  }

  async close(): Promise<void> {
    if (this.redis.status === 'end') return;
    await this.redis.quit();
  }

  async publish(envelope: SidecarEnvelope): Promise<string> {
    await this.connect();
    const streamName = `${this.streamPrefix}:${envelope.stream}:${sanitizePair(envelope.pair)}`;
    const fields = [
      'ts',
      envelope.ts,
      'source',
      envelope.source,
      'event',
      envelope.event,
      'pair',
      envelope.pair ?? '',
      'payload',
      JSON.stringify(envelope.payload),
    ];
    const id = await this.redis.xadd(streamName, '*', ...fields);
    if (!id) {
      throw new Error(`Redis XADD returned empty id for stream ${streamName}`);
    }
    return id;
  }
}
