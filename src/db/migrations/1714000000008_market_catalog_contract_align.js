/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE market_catalog ADD COLUMN IF NOT EXISTS precision_base INT;
    ALTER TABLE market_catalog ADD COLUMN IF NOT EXISTS precision_quote INT;

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

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'market_catalog'
          AND column_name = 'step' AND udt_name = 'numeric'
      ) THEN
        ALTER TABLE market_catalog ALTER COLUMN step DROP DEFAULT;
        ALTER TABLE market_catalog ALTER COLUMN step TYPE TEXT USING (trim(both FROM step::text));
      END IF;
    END
    $$;

    ALTER TABLE market_catalog ALTER COLUMN product DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Non-destructive down: leave widened schema in place.
  `);
};
