/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE audit_events (
      id        bigserial PRIMARY KEY,
      ts        timestamptz NOT NULL DEFAULT now(),
      kind      text NOT NULL,
      source    text NOT NULL,
      seq       bigint,
      payload   jsonb NOT NULL
    );
    CREATE INDEX audit_events_kind_ts_idx ON audit_events (kind, ts DESC);

    CREATE TABLE seq_cursor (
      stream    text PRIMARY KEY,
      last_seq  bigint NOT NULL,
      last_ts   timestamptz NOT NULL
    );

    CREATE TABLE signal_log (
      id        bigserial PRIMARY KEY,
      ts        timestamptz NOT NULL DEFAULT now(),
      strategy  text NOT NULL,
      type      text NOT NULL,
      pair      text,
      severity  text NOT NULL CHECK (severity IN ('info','warn','critical')),
      payload   jsonb NOT NULL
    );
    CREATE INDEX signal_log_strategy_ts_idx ON signal_log (strategy, ts DESC);
    CREATE INDEX signal_log_pair_ts_idx     ON signal_log (pair, ts DESC) WHERE pair IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS signal_log;
    DROP TABLE IF EXISTS seq_cursor;
    DROP TABLE IF EXISTS audit_events;
  `);
};
