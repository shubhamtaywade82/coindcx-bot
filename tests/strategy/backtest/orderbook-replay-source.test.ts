import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { OrderbookReplaySource } from '../../../src/strategy/backtest/sources/orderbook-replay-source';

describe('OrderbookReplaySource', () => {
  it('replays depth snapshot/delta and emits ordered tick events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ob-replay-'));
    const path = join(dir, 'frames.jsonl');
    const lines = [
      JSON.stringify({
        ts: 1_000,
        channel: 'depth-snapshot',
        raw: {
          pair: 'B-BTC_USDT',
          asks: { '101': '1' },
          bids: { '99': '1' },
        },
      }),
      JSON.stringify({
        ts: 2_000,
        channel: 'depth-update',
        raw: {
          pair: 'B-BTC_USDT',
          asks: { '101': '0', '102': '2' },
          bids: { '99': '0', '100': '3' },
        },
      }),
    ];
    writeFileSync(path, lines.join('\n'));
    const source = new OrderbookReplaySource({
      path,
      pair: 'B-BTC_USDT',
      fromMs: 0,
      toMs: 10_000,
    });
    const events = [];
    for await (const event of source.iterate()) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0]?.asks).toBeDefined();
    expect(events[1]?.bids).toBeDefined();
    expect(source.coverage()).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads compressed jsonl.gz replay files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ob-replay-'));
    const path = join(dir, 'frames.jsonl.gz');
    const body = JSON.stringify({
      ts: 1_000,
      channel: 'new-trade',
      raw: {
        pair: 'B-BTC_USDT',
        price: '100',
      },
    }) + '\n';
    writeFileSync(path, gzipSync(Buffer.from(body, 'utf8')));
    const source = new OrderbookReplaySource({
      path,
      pair: 'B-BTC_USDT',
      fromMs: 0,
      toMs: 10_000,
    });
    const events = [];
    for await (const event of source.iterate()) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.price).toBe(100);
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches symbol-form trade rows against futures pair input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ob-replay-'));
    const path = join(dir, 'frames.jsonl');
    const lines = [
      JSON.stringify({
        ts: 1_000,
        channel: 'new-trade',
        raw: {
          s: 'BTCUSDT',
          p: '101.5',
        },
      }),
    ];
    writeFileSync(path, lines.join('\n'));
    const source = new OrderbookReplaySource({
      path,
      pair: 'B-BTC_USDT',
      fromMs: 0,
      toMs: 10_000,
    });
    const events = [];
    for await (const event of source.iterate()) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.price).toBe(101.5);
    rmSync(dir, { recursive: true, force: true });
  });
});
