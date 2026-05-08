/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE strategy_prediction_outcomes (
      id                 bigserial PRIMARY KEY,
      client_signal_id   text NOT NULL UNIQUE,
      strategy           text NOT NULL,
      pair               text NOT NULL,
      signal_ts          timestamptz NOT NULL,
      side               text NOT NULL CHECK (side IN ('LONG','SHORT')),
      entry              numeric,
      stop_loss          numeric,
      take_profit        numeric,
      ttl_ms             bigint NOT NULL DEFAULT 21600000,
      status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
      outcome            text CHECK (outcome IS NULL OR outcome IN ('tp_first','sl_first','ttl_neutral','invalid_geometry')),
      resolved_ts        timestamptz,
      bars_examined      int,
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX strategy_prediction_outcomes_pair_pending_idx
      ON strategy_prediction_outcomes (pair, status, signal_ts DESC)
      WHERE status = 'pending';

    CREATE TABLE strategy_adaptive_confidence (
      pair             text NOT NULL,
      strategy_id      text NOT NULL,
      min_confidence   numeric NOT NULL,
      updated_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (pair, strategy_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS strategy_adaptive_confidence;
    DROP TABLE IF EXISTS strategy_prediction_outcomes;
  `);
};
