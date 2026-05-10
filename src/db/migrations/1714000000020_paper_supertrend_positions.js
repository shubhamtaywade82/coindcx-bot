/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE paper_supertrend_positions (
      id BIGSERIAL PRIMARY KEY,
      pair TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
      status TEXT NOT NULL CHECK (status IN ('open','closed_tp','closed_manual')),
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      capital_usdt NUMERIC NOT NULL,
      legs JSONB NOT NULL,
      avg_entry NUMERIC NOT NULL,
      total_notional_usdt NUMERIC NOT NULL,
      tp_price NUMERIC NOT NULL,
      tp_pct NUMERIC NOT NULL,
      realized_pnl_usdt NUMERIC,
      realized_pnl_pct NUMERIC,
      last_mark_price NUMERIC,
      last_mark_pnl_pct NUMERIC,
      last_mark_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      CHECK (jsonb_typeof(legs) IN ('object', 'array'))
    );

    CREATE UNIQUE INDEX paper_supertrend_one_open_per_pair
      ON paper_supertrend_positions (pair) WHERE status = 'open';

    CREATE INDEX paper_supertrend_pair_status
      ON paper_supertrend_positions (pair, status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS paper_supertrend_pair_status;
    DROP INDEX IF EXISTS paper_supertrend_one_open_per_pair;
    DROP TABLE IF EXISTS paper_supertrend_positions;
  `);
};
