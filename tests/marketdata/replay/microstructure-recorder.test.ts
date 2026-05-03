import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MicrostructureRecorder } from '../../../src/marketdata/replay/microstructure-recorder';

describe('MicrostructureRecorder', () => {
  it('writes gzipped durable raw frames and closes cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-rec-'));
    const recorder = new MicrostructureRecorder({
      outDir: dir,
      pair: 'B-BTC_USDT',
      channels: ['depth-snapshot'],
      compress: true,
      flushMs: 1,
      rotateMb: 16,
    });
    await recorder.record('depth-snapshot', { pair: 'B-BTC_USDT', asks: { '100': '1' }, bids: { '99': '1' } });
    await recorder.record('new-trade', { pair: 'B-BTC_USDT', price: '100' });
    const result = await recorder.close();
    expect(result.framesWritten).toBe(1);
    expect(result.files.length).toBe(1);
    const compressed = readFileSync(result.files[0]!);
    const text = gunzipSync(compressed).toString('utf8');
    expect(text).toContain('"channel":"depth-snapshot"');
    expect(text).not.toContain('"channel":"new-trade"');
    rmSync(dir, { recursive: true, force: true });
  });
});
