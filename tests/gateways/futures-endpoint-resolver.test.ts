import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUTURES_ENDPOINTS,
  resolveFuturesEndpointPath,
} from '../../src/gateways/futures-endpoint-resolver';

describe('futures endpoint resolver', () => {
  it('returns configured path for known key', () => {
    const path = resolveFuturesEndpointPath('list_positions');
    expect(path).toBe(DEFAULT_FUTURES_ENDPOINTS.list_positions);
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
