/* eslint-disable */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE strategy_prediction_outcomes
      ADD COLUMN IF NOT EXISTS feature_snapshot jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE strategy_prediction_outcomes
      DROP COLUMN IF EXISTS feature_snapshot;
  `);
};
