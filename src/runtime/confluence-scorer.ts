import type { MarketRegime } from './regime-classifier';

export interface ConfluenceInput {
  pair: string;
  side: 'LONG' | 'SHORT';
  confidence: number;
  regime: MarketRegime;
}

export interface ConfluenceScore {
  pair: string;
  longScore: number;
  shortScore: number;
  regime: MarketRegime;
  scoredAt: string;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function regimeWeight(regime: MarketRegime): number {
  switch (regime) {
    case 'trending':
      return 1;
    case 'compressed':
      return 0.8;
    case 'ranging':
      return 0.65;
    case 'volatile':
      return 0.55;
    case 'unknown':
      return 0.5;
    default: {
      const neverRegime: never = regime;
      throw new Error(`unsupported regime: ${String(neverRegime)}`);
    }
  }
}

export class ConfluenceScorer {
  private readonly byPair = new Map<string, ConfluenceScore>();

  constructor(private readonly clock: () => number = Date.now) {}

  score(input: ConfluenceInput): ConfluenceScore {
    const base = clampScore(input.confidence * 100);
    const weighted = clampScore(base * regimeWeight(input.regime));
    const longScore = input.side === 'LONG' ? weighted : clampScore(100 - weighted);
    const shortScore = input.side === 'SHORT' ? weighted : clampScore(100 - weighted);
    const score: ConfluenceScore = {
      pair: input.pair,
      longScore,
      shortScore,
      regime: input.regime,
      scoredAt: new Date(this.clock()).toISOString(),
    };
    this.byPair.set(input.pair, score);
    return score;
  }

  current(pair: string): ConfluenceScore | undefined {
    return this.byPair.get(pair);
  }
}
