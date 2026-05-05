import { describe, expect, it, vi } from 'vitest';
import { BreakevenProtectionWorker } from '../../../src/runtime/workers/breakeven-protection-worker';

describe('BreakevenProtectionWorker', () => {
  it('arms breakeven once position crosses arm threshold', async () => {
    vi.useFakeTimers();
    try {
      const onBreakevenArm = vi.fn().mockResolvedValue(undefined);
      const worker = new BreakevenProtectionWorker({
        intervalMs: 1000,
        armPct: 0.01,
        logger: { warn: vi.fn() } as any,
        getPositions: () => [
          {
            id: 'pos-1',
            pair: 'B-BTC_USDT',
            side: 'long',
            activePos: '1',
            avgPrice: '100',
            marginCurrency: 'USDT',
            unrealizedPnl: '1',
            realizedPnl: '0',
            updatedAt: new Date().toISOString(),
            source: 'ws',
          },
        ],
        getMarkPrice: () => 101.5,
        onBreakevenArm,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onBreakevenArm).toHaveBeenCalledTimes(1);
      expect(onBreakevenArm).toHaveBeenCalledWith(
        expect.objectContaining({
          pair: 'B-BTC_USDT',
          positionId: 'pos-1',
          side: 'long',
        }),
      );
      worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm when position progress is below threshold', async () => {
    vi.useFakeTimers();
    try {
      const onBreakevenArm = vi.fn().mockResolvedValue(undefined);
      const worker = new BreakevenProtectionWorker({
        intervalMs: 1000,
        armPct: 0.02,
        logger: { warn: vi.fn() } as any,
        getPositions: () => [
          {
            id: 'pos-1',
            pair: 'B-BTC_USDT',
            side: 'long',
            activePos: '1',
            avgPrice: '100',
            marginCurrency: 'USDT',
            unrealizedPnl: '0.5',
            realizedPnl: '0',
            updatedAt: new Date().toISOString(),
            source: 'ws',
          },
        ],
        getMarkPrice: () => 101,
        onBreakevenArm,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onBreakevenArm).not.toHaveBeenCalled();
      worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
