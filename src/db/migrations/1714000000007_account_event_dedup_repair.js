/* eslint-disable */
exports.up = (pgm) => {
  // Keep table + indexes in one DO block so DDL is visible to the same PL/pgSQL unit
  // (avoids "relation account_event_dedup does not exist" when the runner uses one mega-transaction).
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
      IF to_regclass('public.account_event_dedup') IS NOT NULL THEN
        CREATE UNIQUE INDEX IF NOT EXISTS account_event_dedup_client_event_uidx
          ON account_event_dedup(client_order_id, event_id);
        CREATE INDEX IF NOT EXISTS account_event_dedup_entity_idx
          ON account_event_dedup(entity);
        CREATE INDEX IF NOT EXISTS account_event_dedup_entity_created_idx
          ON account_event_dedup(entity, created_at DESC);
      END IF;
    END
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Repair migration is intentionally non-destructive on rollback.
  `);
};
