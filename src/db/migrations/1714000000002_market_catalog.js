/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE market_catalog (
      pair                TEXT PRIMARY KEY,
      symbol              TEXT NOT NULL,
      ecode               TEXT NOT NULL,
      product             TEXT NOT NULL,
      base_ccy            TEXT,
      target_ccy          TEXT,
      step                NUMERIC(36,18),
      price_precision     INT,
      quantity_precision  INT,
      min_notional        NUMERIC(36,18),
      max_leverage        INT,
      payload             JSONB NOT NULL,
      refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX market_catalog_symbol_idx ON market_catalog(symbol);
    CREATE INDEX market_catalog_refreshed_idx ON market_catalog(refreshed_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS market_catalog;
  `);
};
