/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE signals (
      id            BIGSERIAL PRIMARY KEY,
      signal_id     TEXT NOT NULL UNIQUE,
      ts            TIMESTAMPTZ NOT NULL,
      strategy      TEXT NOT NULL,
      type          TEXT NOT NULL,
      pair          TEXT,
      severity      TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
      payload       JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX signals_ts_idx ON signals(ts DESC);
    CREATE INDEX signals_pair_ts_idx ON signals(pair, ts DESC) WHERE pair IS NOT NULL;
    CREATE INDEX signals_type_ts_idx ON signals(type, ts DESC);

    CREATE TABLE risk_events (
      id            BIGSERIAL PRIMARY KEY,
      event_id      TEXT NOT NULL UNIQUE,
      ts            TIMESTAMPTZ NOT NULL,
      strategy      TEXT NOT NULL,
      type          TEXT NOT NULL,
      pair          TEXT,
      severity      TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
      payload       JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX risk_events_ts_idx ON risk_events(ts DESC);
    CREATE INDEX risk_events_pair_ts_idx ON risk_events(pair, ts DESC) WHERE pair IS NOT NULL;
    CREATE INDEX risk_events_type_ts_idx ON risk_events(type, ts DESC);

    CREATE TABLE trades (
      id            TEXT PRIMARY KEY,
      ts            TIMESTAMPTZ NOT NULL,
      pair          TEXT NOT NULL,
      side          TEXT NOT NULL,
      price         NUMERIC(36,18) NOT NULL,
      qty           NUMERIC(36,18) NOT NULL,
      order_id      TEXT,
      position_id   TEXT,
      source        TEXT NOT NULL,
      payload       JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX trades_ts_idx ON trades(ts DESC);
    CREATE INDEX trades_pair_ts_idx ON trades(pair, ts DESC);

    CREATE TABLE orderbook_snapshots (
      id            BIGSERIAL PRIMARY KEY,
      pair          TEXT NOT NULL,
      channel       TEXT NOT NULL,
      ts            TIMESTAMPTZ NOT NULL,
      exchange_ts   BIGINT,
      best_bid      NUMERIC(36,18),
      best_ask      NUMERIC(36,18),
      spread        NUMERIC(36,18),
      checksum      TEXT,
      bids          JSONB NOT NULL,
      asks          JSONB NOT NULL,
      state         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX orderbook_snapshots_pair_ts_idx ON orderbook_snapshots(pair, ts DESC);
    CREATE INDEX orderbook_snapshots_channel_ts_idx ON orderbook_snapshots(channel, ts DESC);

    CREATE TABLE replay_artifacts (
      id            BIGSERIAL PRIMARY KEY,
      pair          TEXT,
      channel       TEXT NOT NULL,
      artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('ws_frame','orderbook_gap','orderbook_resync')),
      ts            TIMESTAMPTZ NOT NULL,
      exchange_ts   BIGINT,
      payload       JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX replay_artifacts_ts_idx ON replay_artifacts(ts DESC);
    CREATE INDEX replay_artifacts_pair_ts_idx ON replay_artifacts(pair, ts DESC) WHERE pair IS NOT NULL;
    CREATE INDEX replay_artifacts_channel_ts_idx ON replay_artifacts(channel, ts DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS replay_artifacts;
    DROP TABLE IF EXISTS orderbook_snapshots;
    DROP TABLE IF EXISTS trades;
    DROP TABLE IF EXISTS risk_events;
    DROP TABLE IF EXISTS signals;
  `);
};
