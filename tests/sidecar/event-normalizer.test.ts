import { describe, expect, it } from 'vitest';
import { normalizeSidecarEvent } from '../../src/sidecar/event-normalizer';

describe('sidecar event normalizer', () => {
  it('maps futures market event into market stream envelope', () => {
    const envelope = normalizeSidecarEvent(
      'futures-orderbook-update',
      { s: 'B-BTC_USDT', bids: [['1', '2']] },
      '2026-05-03T00:00:00.000Z',
    );
    expect(envelope).toEqual(
      expect.objectContaining({
        stream: 'market.orderbook.update',
        pair: 'BTCUSDT',
        event: 'futures-orderbook-update',
      }),
    );
  });

  it('maps account event into account stream envelope', () => {
    const envelope = normalizeSidecarEvent(
      'df-order-update',
      { id: 'o-1', pair: 'B-BTC_USDT' },
      '2026-05-03T00:00:00.000Z',
    );
    expect(envelope).toEqual(
      expect.objectContaining({
        stream: 'account.order',
        pair: 'BTCUSDT',
        event: 'df-order-update',
      }),
    );
  });

  it('returns null for unsupported events', () => {
    const envelope = normalizeSidecarEvent('unsupported-event', { ok: true });
    expect(envelope).toBeNull();
  });
});
