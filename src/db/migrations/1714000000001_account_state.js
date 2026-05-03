/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE positions (
      id              TEXT PRIMARY KEY,
      pair            TEXT NOT NULL,
      side            TEXT NOT NULL,
      active_pos      NUMERIC(36,18) NOT NULL,
      avg_price       NUMERIC(36,18) NOT NULL,
      mark_price      NUMERIC(36,18),
      liquidation_price NUMERIC(36,18),
      leverage        NUMERIC(10,2),
      margin_currency TEXT,
      unrealized_pnl  NUMERIC(36,18),
      realized_pnl    NUMERIC(36,18) DEFAULT 0,
      opened_at       TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL,
      source          TEXT NOT NULL
    );
    CREATE INDEX positions_pair_idx ON positions(pair);

    CREATE TABLE balances (
      currency        TEXT PRIMARY KEY,
      available       NUMERIC(36,18) NOT NULL,
      locked          NUMERIC(36,18) NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL,
      source          TEXT NOT NULL
    );

    CREATE TABLE orders (
      id              TEXT PRIMARY KEY,
      pair            TEXT NOT NULL,
      side            TEXT NOT NULL,
      type            TEXT NOT NULL,
      status          TEXT NOT NULL,
      price           NUMERIC(36,18),
      total_quantity  NUMERIC(36,18),
      remaining_qty   NUMERIC(36,18),
      avg_fill_price  NUMERIC(36,18),
      position_id     TEXT REFERENCES positions(id),
      created_at      TIMESTAMPTZ NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL,
      source          TEXT NOT NULL
    );
    CREATE INDEX orders_status_idx   ON orders(status);
    CREATE INDEX orders_position_idx ON orders(position_id);

    CREATE TABLE fills_ledger (
      id              TEXT PRIMARY KEY,
      order_id        TEXT REFERENCES orders(id),
      position_id     TEXT REFERENCES positions(id),
      pair            TEXT NOT NULL,
      side            TEXT NOT NULL,
      price           NUMERIC(36,18) NOT NULL,
      qty             NUMERIC(36,18) NOT NULL,
      fee             NUMERIC(36,18),
      fee_currency    TEXT,
      realized_pnl    NUMERIC(36,18),
      executed_at     TIMESTAMPTZ NOT NULL,
      ingested_at     TIMESTAMPTZ NOT NULL,
      source          TEXT NOT NULL
    );
    CREATE INDEX fills_executed_idx ON fills_ledger(executed_at);
    CREATE INDEX fills_pair_idx     ON fills_ledger(pair);

    CREATE TABLE account_changelog (
      id              BIGSERIAL PRIMARY KEY,
      entity          TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      field           TEXT NOT NULL,
      old_value       TEXT,
      new_value       TEXT,
      cause           TEXT NOT NULL,
      severity        TEXT,
      recorded_at     TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX changelog_entity_idx   ON account_changelog(entity, entity_id);
    CREATE INDEX changelog_recorded_idx ON account_changelog(recorded_at);

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS account_changelog;
    DROP TABLE IF EXISTS fills_ledger;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS balances;
    DROP TABLE IF EXISTS positions;
  `);
};
