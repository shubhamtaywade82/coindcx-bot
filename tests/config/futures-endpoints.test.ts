import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  loadFuturesEndpointCatalogFromPath,
  validateFuturesEndpointCatalog,
} from '../../src/config/futures-endpoints';

const SPEC_PATH = path.resolve(process.cwd(), 'config/coindcx_futures_endpoints.yml');

describe('futures endpoints spec', () => {
  it('loads yaml and validates required sections', () => {
    const catalog = loadFuturesEndpointCatalogFromPath(SPEC_PATH);
    const issues = validateFuturesEndpointCatalog(catalog);
    expect(issues).toEqual([]);
    expect(catalog.endpoints.length).toBeGreaterThan(10);
    expect(catalog.endpoints.some((e) => e.key === 'list_orders')).toBe(true);
    expect(catalog.endpoints.some((e) => e.key === 'list_positions')).toBe(true);
  });
});
