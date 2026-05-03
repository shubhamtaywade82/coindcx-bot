/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE paper_trades (
      id              BIGSERIAL PRIMARY KEY,
      paper_trade_id  TEXT NOT NULL UNIQUE,
      ts              TIMESTAMPTZ NOT NULL,
      pair            TEXT NOT NULL,
      side            TEXT NOT NULL,
      intent_id       TEXT NOT NULL,
      route           TEXT NOT NULL DEFAULT 'paper',
      reason          TEXT NOT NULL,
      payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (jsonb_typeof(payload) IN ('object', 'array'))
    );

    CREATE INDEX paper_trades_pair_ts_idx
      ON paper_trades(pair, ts DESC);
    CREATE INDEX paper_trades_intent_ts_idx
      ON paper_trades(intent_id, ts DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS paper_trades_intent_ts_idx;
    DROP INDEX IF EXISTS paper_trades_pair_ts_idx;
    DROP TABLE IF EXISTS paper_trades;
  `);
};
