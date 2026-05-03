import type { MarketRegime } from './regime-classifier';

export interface ConfluenceInput {
  pair: string;
  side: 'LONG' | 'SHORT';
  regime: MarketRegime;
  confidence: number;
  components?: Record<string, number>;
  shortComponents?: Record<string, number>;
  microstructureContribution?: number;
}

export interface ConfluenceScore {
  pair: string;
  longScore: number;
  shortScore: number;
  regime: MarketRegime;
  components: Record<string, number>;
  shortComponents: Record<string, number>;
  maxScore: number;
  scoreSpread: number;
  fireGatePassed: boolean;
  volatileExceptionApplied: boolean;
  scoredAt: string;
}

export interface ConfluenceDecision {
  shouldFire: boolean;
  dominantSide: 'LONG' | 'SHORT' | 'NONE';
  maxScore: number;
  scoreSpread: number;
  volatileExceptionApplied: boolean;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampContribution(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

const FIRE_SCORE_THRESHOLD = 75;
const FIRE_SPREAD_THRESHOLD = 25;
const VOLATILE_MICROSTRUCTURE_EXCEPTION_THRESHOLD = 0.7;

const DEFAULT_COMPONENTS: Record<string, number> = {
  confidence: 0,
};

const REGIME_COMPONENT_WEIGHTS: Record<MarketRegime, Record<string, number>> = {
  trending: {
    confidence: 0.25,
    structure: 0.2,
    momentum: 0.2,
    microstructure: 0.2,
    risk: 0.15,
  },
  compressed: {
    confidence: 0.2,
    structure: 0.25,
    momentum: 0.15,
    microstructure: 0.25,
    risk: 0.15,
  },
  ranging: {
    confidence: 0.2,
    structure: 0.2,
    momentum: 0.2,
    microstructure: 0.2,
    risk: 0.2,
  },
  volatile: {
    confidence: 0.2,
    structure: 0.15,
    momentum: 0.2,
    microstructure: 0.3,
    risk: 0.15,
  },
  unknown: {
    confidence: 0.25,
    structure: 0.2,
    momentum: 0.2,
    microstructure: 0.2,
    risk: 0.15,
  },
};

function regimeWeights(regime: MarketRegime): Record<string, number> {
  switch (regime) {
    case 'trending':
      return REGIME_COMPONENT_WEIGHTS.trending;
    case 'compressed':
      return REGIME_COMPONENT_WEIGHTS.compressed;
    case 'ranging':
      return REGIME_COMPONENT_WEIGHTS.ranging;
    case 'volatile':
      return REGIME_COMPONENT_WEIGHTS.volatile;
    case 'unknown':
      return REGIME_COMPONENT_WEIGHTS.unknown;
    default: {
      const neverRegime: never = regime;
      throw new Error(`unsupported regime: ${String(neverRegime)}`);
    }
  }
}

function weightedComponentScore(regime: MarketRegime, components: Record<string, number>): number {
  const weights = regimeWeights(regime);
  let score = 0;
  let totalWeight = 0;
  for (const [component, weight] of Object.entries(weights)) {
    totalWeight += weight;
    const contribution = clampContribution(components[component] ?? 0);
    score += ((contribution + 1) / 2) * weight * 100;
  }
  if (totalWeight <= 0) return 50;
  return score / totalWeight;
}

function decide(score: ConfluenceScore): ConfluenceDecision {
  const dominantSide: ConfluenceDecision['dominantSide'] =
    score.longScore > score.shortScore
      ? 'LONG'
      : score.shortScore > score.longScore
        ? 'SHORT'
        : 'NONE';

  const primaryGate =
    score.maxScore >= FIRE_SCORE_THRESHOLD &&
    score.scoreSpread >= FIRE_SPREAD_THRESHOLD;

  const microstructureMagnitude = Math.max(
    Math.abs(clampContribution(score.components.microstructure ?? 0)),
    Math.abs(clampContribution(score.shortComponents.microstructure ?? 0)),
  );
  const volatileException =
    score.regime === 'volatile' &&
    score.maxScore >= FIRE_SCORE_THRESHOLD &&
    microstructureMagnitude >= VOLATILE_MICROSTRUCTURE_EXCEPTION_THRESHOLD;

  return {
    shouldFire: primaryGate || volatileException,
    dominantSide,
    maxScore: score.maxScore,
    scoreSpread: score.scoreSpread,
    volatileExceptionApplied: !primaryGate && volatileException,
  };
}

function normalizeComponents(components: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(components).map(([component, value]) => [component, clampContribution(value)]),
  );
}

export class ConfluenceScorer {
  private readonly byPair = new Map<string, ConfluenceScore>();

  constructor(private readonly clock: () => number = Date.now) {}

  score(input: ConfluenceInput): ConfluenceScore {
    const normalizedConfidence = Math.max(0, Math.min(1, input.confidence));
    const confidenceContribution = ((normalizedConfidence * 2) - 1) * (input.side === 'SHORT' ? -1 : 1);
    const components = normalizeComponents({
      ...DEFAULT_COMPONENTS,
      confidence: confidenceContribution,
      ...(input.components ?? {}),
      ...(input.microstructureContribution !== undefined
        ? { microstructure: input.microstructureContribution }
        : {}),
    });
    const shortComponents = normalizeComponents({
      ...DEFAULT_COMPONENTS,
      confidence: -confidenceContribution,
      ...(input.shortComponents ??
        Object.fromEntries(
          Object.entries(components).map(([component, value]) => [component, -value]),
        )),
    });

    const longComponentScore = weightedComponentScore(
      input.regime,
      components,
    );
    const shortComponentScore = weightedComponentScore(input.regime, shortComponents);
    const longScore = clampScore(longComponentScore);
    const shortScore = clampScore(shortComponentScore);
    const maxScore = Math.max(longScore, shortScore);
    const scoreSpread = Math.abs(longScore - shortScore);
    const score: ConfluenceScore = {
      pair: input.pair,
      longScore,
      shortScore,
      regime: input.regime,
      components,
      shortComponents,
      maxScore,
      scoreSpread,
      fireGatePassed: false,
      volatileExceptionApplied: false,
      scoredAt: new Date(this.clock()).toISOString(),
    };
    const decision = decide(score);
    score.fireGatePassed = decision.shouldFire;
    score.volatileExceptionApplied = decision.volatileExceptionApplied;
    this.byPair.set(input.pair, score);
    return score;
  }

  decision(pair: string): ConfluenceDecision | undefined {
    const current = this.byPair.get(pair);
    if (!current) return undefined;
    return decide(current);
  }

  current(pair: string): ConfluenceScore | undefined {
    return this.byPair.get(pair);
  }
}
