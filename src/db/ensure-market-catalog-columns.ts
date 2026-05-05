import type { Pool } from 'pg';

/**
 * Idempotent alignment for `market_catalog` (migration 1714000000008).
 * Repairs deployments where `npm run db:migrate` was not run after schema changes.
 */
export async function ensureMarketCatalogColumns(pool: Pool): Promise<void> {
  await pool.query(`
    ALTER TABLE market_catalog ADD COLUMN IF NOT EXISTS precision_base INT;
    ALTER TABLE market_catalog ADD COLUMN IF NOT EXISTS precision_quote INT;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'market_catalog' AND column_name = 'quantity_precision'
      ) THEN
        UPDATE market_catalog SET precision_base = COALESCE(precision_base, quantity_precision);
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'market_catalog' AND column_name = 'price_precision'
      ) THEN
        UPDATE market_catalog SET precision_quote = COALESCE(precision_quote, price_precision);
      END IF;
    END
    $$;
  `);
}
