import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUTURES_ENDPOINTS,
  resolveFuturesEndpointPath,
} from '../../src/gateways/futures-endpoint-resolver';

describe('futures endpoint resolver', () => {
  it('returns configured path for known key from captured catalog', () => {
    const path = resolveFuturesEndpointPath(
      'list_positions',
      {
        catalogVersion: 1,
        source: {
          docsHost: 'docs.coindcx.com',
          requiresAuthenticatedCapture: true,
          captureStatus: 'captured',
          capturedAt: '2026-05-03T00:00:00.000Z',
          capturedBy: 'test',
        },
        endpoints: [
          {
            key: 'list_positions',
            label: 'List positions',
            method: 'POST',
            path: '/exchange/v1/derivatives/futures/positions/list',
            paramsSpec: 'captured',
            status: 'captured',
          },
        ],
      },
    );
    expect(path).toBe('/exchange/v1/derivatives/futures/positions/list');
  });

  it('falls back to defaults when catalog path is not concrete', () => {
    const path = resolveFuturesEndpointPath('list_orders');
    expect(path).toBe(DEFAULT_FUTURES_ENDPOINTS.list_orders);
  });

  it('throws for unknown key', () => {
    expect(() =>
      resolveFuturesEndpointPath('not_a_real_key' as keyof typeof DEFAULT_FUTURES_ENDPOINTS),
    ).toThrow(/Unknown futures endpoint key/);
  });
});
