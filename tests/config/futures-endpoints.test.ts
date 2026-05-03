import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadFuturesEndpointSpec, validateFuturesEndpointSpec } from '../../src/config/futures-endpoints';

const SPEC_PATH = path.resolve(process.cwd(), 'config/coindcx_futures_endpoints.yml');

describe('futures endpoints spec', () => {
  it('loads yaml and validates required sections', () => {
    const spec = loadFuturesEndpointSpec(SPEC_PATH);
    const issues = validateFuturesEndpointSpec(spec);
    expect(issues).toEqual([]);
    expect(spec.sections).toHaveProperty('orders');
    expect(spec.sections).toHaveProperty('positions');
  });
});
