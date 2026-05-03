/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE markets (
      pair             TEXT PRIMARY KEY,
      symbol           TEXT NOT NULL,
      ecode            TEXT NOT NULL,
      precision_base   INT,
      precision_quote  INT,
      step             TEXT,
      min_notional     NUMERIC(36,18),
      max_leverage     NUMERIC(10,2),
      payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
      refreshed_at     TIMESTAMPTZ NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (jsonb_typeof(payload) IN ('object', 'array'))
    );
    CREATE INDEX markets_symbol_idx ON markets(symbol);
    CREATE INDEX markets_ecode_idx ON markets(ecode);
    CREATE INDEX markets_refreshed_idx ON markets(refreshed_at DESC);

    CREATE TABLE candles (
      id               BIGSERIAL PRIMARY KEY,
      pair             TEXT NOT NULL,
      timeframe        TEXT NOT NULL,
      open_time        TIMESTAMPTZ NOT NULL,
      close_time       TIMESTAMPTZ NOT NULL,
      open             NUMERIC(36,18) NOT NULL,
      high             NUMERIC(36,18) NOT NULL,
      low              NUMERIC(36,18) NOT NULL,
      close            NUMERIC(36,18) NOT NULL,
      volume           NUMERIC(36,18) NOT NULL DEFAULT 0,
      source           TEXT NOT NULL DEFAULT 'unknown',
      payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (pair, timeframe, open_time),
      CHECK (jsonb_typeof(payload) IN ('object', 'array'))
    );
    CREATE INDEX candles_pair_tf_open_idx ON candles(pair, timeframe, open_time DESC);
    CREATE INDEX candles_close_time_idx ON candles(close_time DESC);

    CREATE VIEW order_book_snapshots AS
      SELECT
        id,
        pair,
        channel,
        ts,
        exchange_ts,
        best_bid,
        best_ask,
        spread,
        checksum,
        bids,
        asks,
        state,
        created_at
      FROM orderbook_snapshots;

    CREATE INDEX signals_pair_strategy_ts_idx
      ON signals(pair, strategy, ts DESC)
      WHERE pair IS NOT NULL;
    CREATE INDEX risk_events_pair_strategy_ts_idx
      ON risk_events(pair, strategy, ts DESC)
      WHERE pair IS NOT NULL;
    CREATE INDEX trades_pair_source_ts_idx
      ON trades(pair, source, ts DESC);
    CREATE INDEX replay_artifacts_replay_cursor_idx
      ON replay_artifacts(channel, pair, ts DESC, id DESC);

    CREATE INDEX account_event_dedup_entity_created_idx
      ON account_event_dedup(entity, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS account_event_dedup_entity_created_idx;
    DROP INDEX IF EXISTS replay_artifacts_replay_cursor_idx;
    DROP INDEX IF EXISTS trades_pair_source_ts_idx;
    DROP INDEX IF EXISTS risk_events_pair_strategy_ts_idx;
    DROP INDEX IF EXISTS signals_pair_strategy_ts_idx;
    DROP VIEW IF EXISTS order_book_snapshots;
    DROP TABLE IF EXISTS candles;
    DROP TABLE IF EXISTS markets;
  `);
};
