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

  it('rejects untrusted source docs host', () => {
    const catalog = loadFuturesEndpointCatalogFromPath(SPEC_PATH);
    catalog.source.docsHost = 'gist.github.com';
    const issues = validateFuturesEndpointCatalog(catalog);
    expect(issues).toContain('source.docsHost must be "docs.coindcx.com"');
  });

  it('rejects gist/snippet links in source notes', () => {
    const catalog = loadFuturesEndpointCatalogFromPath(SPEC_PATH);
    catalog.source.notes = 'Captured from https://gist.github.com/example/abc';
    const issues = validateFuturesEndpointCatalog(catalog);
    expect(issues).toContain('source.notes must not reference third-party gist/snippet URLs');
  });

  it('rejects gist/snippet links in endpoint paramsSpec', () => {
    const catalog = loadFuturesEndpointCatalogFromPath(SPEC_PATH);
    catalog.endpoints[0]!.paramsSpec = 'https://raw.githubusercontent.com/user/repo/main/spec.md';
    const issues = validateFuturesEndpointCatalog(catalog);
    expect(issues).toContain(
      `endpoint "${catalog.endpoints[0]!.key}" paramsSpec must not reference third-party gist/snippet URLs`,
    );
  });
});
