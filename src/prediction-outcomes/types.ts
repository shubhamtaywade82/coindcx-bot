export interface PredictionFeedback {
  /** Last N resolved predictions for this pair (tracked strategies with outcome rows). */
  recent_resolved: Array<{
    strategy: string;
    side: string;
    outcome: 'tp_first' | 'sl_first' | 'ttl_neutral' | 'invalid_geometry';
    resolved_at_iso: string | null;
  }>;
  wins_vs_losses: {
    tp_first: number;
    sl_first: number;
    ttl_neutral: number;
    invalid_geometry: number;
    sample_n: number;
  };
  /** Optional floors from adaptive learner (same units as model confidence 0–1). */
  adaptive_min_confidence_llm: number | null;
  adaptive_min_confidence_conductor: number | null;
}
