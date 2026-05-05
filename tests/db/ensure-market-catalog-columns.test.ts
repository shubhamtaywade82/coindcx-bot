import { describe, it, expect, vi } from 'vitest';
import { ensureMarketCatalogColumns } from '../../src/db/ensure-market-catalog-columns';

describe('ensureMarketCatalogColumns', () => {
  it('runs ALTER and backfill statements', async () => {
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }),
    };
    await ensureMarketCatalogColumns(pool as any);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(queries[0]).toContain('precision_base');
    expect(queries[1]).toContain('quantity_precision');
  });
});
