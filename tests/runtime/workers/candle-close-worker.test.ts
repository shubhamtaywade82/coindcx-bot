import { describe, expect, it, vi } from 'vitest';
import { CandleCloseWorker } from '../../../src/runtime/workers/candle-close-worker';

describe('CandleCloseWorker', () => {
  it('fires callback when a bucket rolls over', async () => {
    vi.useFakeTimers();
    try {
      let now = Date.parse('2026-05-03T12:00:00.000Z');
      const onCandleClose = vi.fn().mockResolvedValue(undefined);
      const logger = { warn: vi.fn() } as any;
      const worker = new CandleCloseWorker({
        pairs: ['B-BTC_USDT'],
        timeframes: ['1m'],
        tickMs: 1_000,
        logger,
        clock: () => now,
        onCandleClose,
      });
      worker.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onCandleClose).toHaveBeenCalledTimes(0);

      now += 61_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onCandleClose).toHaveBeenCalledTimes(1);
      expect(onCandleClose).toHaveBeenCalledWith('B-BTC_USDT', '1m', expect.any(Number));
      worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
