/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE VIEW probability_of_profit_by_regime_score AS
    WITH fired_signals AS (
      SELECT
        s.signal_id,
        s.ts,
        s.pair,
        lower(coalesce(s.payload->'regime'->>'value', 'unknown')) AS regime,
        greatest(
          coalesce((s.payload->'confluence'->>'longScore')::numeric, 0),
          coalesce((s.payload->'confluence'->>'shortScore')::numeric, 0)
        ) AS max_score,
        floor(
          greatest(
            coalesce((s.payload->'confluence'->>'longScore')::numeric, 0),
            coalesce((s.payload->'confluence'->>'shortScore')::numeric, 0)
          ) / 5
        ) * 5 AS score_bucket_5,
        CASE
          WHEN s.type = 'strategy.long' THEN 'LONG'
          WHEN s.type = 'strategy.short' THEN 'SHORT'
          ELSE NULL
        END AS side,
        coalesce(
          nullif(s.payload->>'entry', '')::numeric,
          nullif(s.payload->>'entryPrice', '')::numeric
        ) AS entry_price,
        nullif(s.payload->>'stopLoss', '')::numeric AS stop_loss,
        coalesce(nullif(s.payload->>'ttlMs', '')::bigint, 21600000) AS ttl_ms
      FROM signals s
      WHERE
        s.ts >= (now() - interval '30 days')
        AND s.type IN ('strategy.long', 'strategy.short')
        AND coalesce((s.payload->'confluence'->>'fireGatePassed')::boolean, false) = true
    ),
    levels AS (
      SELECT
        f.signal_id,
        f.ts,
        f.pair,
        f.regime,
        f.max_score,
        f.score_bucket_5,
        f.side,
        f.entry_price,
        f.stop_loss,
        abs(f.entry_price - f.stop_loss) AS risk_r,
        f.ts + ((f.ttl_ms::text || ' milliseconds')::interval) AS end_ts
      FROM fired_signals f
      WHERE
        f.pair IS NOT NULL
        AND f.side IS NOT NULL
        AND f.entry_price IS NOT NULL
        AND f.stop_loss IS NOT NULL
        AND f.ttl_ms > 0
        AND abs(f.entry_price - f.stop_loss) > 0
    ),
    touches AS (
      SELECT
        l.signal_id,
        l.regime,
        l.score_bucket_5,
        l.ts,
        min(t.ts) FILTER (
          WHERE
            (l.side = 'LONG' AND t.price >= (l.entry_price + l.risk_r))
            OR (l.side = 'SHORT' AND t.price <= (l.entry_price - l.risk_r))
        ) AS hit_1r_at,
        min(t.ts) FILTER (
          WHERE
            (l.side = 'LONG' AND t.price >= (l.entry_price + (l.risk_r * 3)))
            OR (l.side = 'SHORT' AND t.price <= (l.entry_price - (l.risk_r * 3)))
        ) AS hit_3r_at,
        min(t.ts) FILTER (
          WHERE
            (l.side = 'LONG' AND t.price <= l.stop_loss)
            OR (l.side = 'SHORT' AND t.price >= l.stop_loss)
        ) AS hit_stop_at
      FROM levels l
      LEFT JOIN trades t
        ON t.pair = l.pair
       AND t.ts >= l.ts
       AND t.ts <= l.end_ts
      GROUP BY l.signal_id, l.regime, l.score_bucket_5, l.ts
    ),
    outcomes AS (
      SELECT
        regime,
        score_bucket_5::int AS score_bucket_5,
        ts,
        CASE
          WHEN hit_1r_at IS NOT NULL AND (hit_stop_at IS NULL OR hit_1r_at <= hit_stop_at) THEN 1
          ELSE 0
        END AS hit_1r,
        CASE
          WHEN hit_3r_at IS NOT NULL AND (hit_stop_at IS NULL OR hit_3r_at <= hit_stop_at) THEN 1
          ELSE 0
        END AS hit_3r,
        CASE
          WHEN hit_stop_at IS NOT NULL
            AND (hit_1r_at IS NULL OR hit_stop_at < hit_1r_at)
            AND (hit_3r_at IS NULL OR hit_stop_at < hit_3r_at) THEN 1
          ELSE 0
        END AS hit_stop
      FROM touches
    ),
    rolling_outcomes AS (
      SELECT
        o.*,
        row_number() OVER (
          PARTITION BY o.regime, o.score_bucket_5
          ORDER BY o.ts DESC
        ) AS recent_rank
      FROM outcomes o
    )
    SELECT
      o.regime,
      o.score_bucket_5,
      count(*)::int AS sample_size,
      (sum(o.hit_1r)::numeric + 1) / (count(*)::numeric + 2) AS p_hit_1r,
      (sum(o.hit_3r)::numeric + 1) / (count(*)::numeric + 2) AS p_hit_3r,
      (sum(o.hit_stop)::numeric + 1) / (count(*)::numeric + 2) AS p_hit_stop,
      (
        ((GREATEST(sum(o.hit_1r) - sum(o.hit_3r), 0)::numeric + 1) / (count(*)::numeric + 2))
        + (((sum(o.hit_3r)::numeric + 1) / (count(*)::numeric + 2)) * 3)
        - ((sum(o.hit_stop)::numeric + 1) / (count(*)::numeric + 2))
      ) AS expected_r
    FROM rolling_outcomes o
    WHERE o.recent_rank <= 200
    GROUP BY o.regime, o.score_bucket_5
    ORDER BY o.regime, o.score_bucket_5;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP VIEW IF EXISTS probability_of_profit_by_regime_score;
  `);
};
