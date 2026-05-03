/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('public.account_event_dedup') IS NULL THEN
        CREATE TABLE account_event_dedup (
          id              BIGSERIAL PRIMARY KEY,
          client_order_id TEXT NOT NULL,
          event_id        TEXT NOT NULL,
          entity          TEXT NOT NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      END IF;
    END
    $$;

    CREATE UNIQUE INDEX IF NOT EXISTS account_event_dedup_client_event_uidx
      ON account_event_dedup(client_order_id, event_id);
    CREATE INDEX IF NOT EXISTS account_event_dedup_entity_idx
      ON account_event_dedup(entity);
    CREATE INDEX IF NOT EXISTS account_event_dedup_entity_created_idx
      ON account_event_dedup(entity, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Repair migration is intentionally non-destructive on rollback.
  `);
};
