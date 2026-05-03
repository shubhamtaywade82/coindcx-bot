export type MarketRegime = 'unknown' | 'trending' | 'compressed' | 'ranging' | 'volatile';

export interface RegimeFeatures {
  adx4h?: number;
  atrPercentile?: number;
  bbWidthPercentile?: number;
  hasMarketStructureShift?: boolean;
}

export interface RegimeSnapshot {
  pair: string;
  regime: MarketRegime;
  features: RegimeFeatures;
  classifiedAt: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function classifyRegime(features: RegimeFeatures): MarketRegime {
  const hasAdx = isFiniteNumber(features.adx4h);
  const hasAtr = isFiniteNumber(features.atrPercentile);
  const hasBb = isFiniteNumber(features.bbWidthPercentile);
  const trending = (hasAdx && features.adx4h >= 25) || features.hasMarketStructureShift === true;
  const compressed = hasBb && features.bbWidthPercentile <= 0.2;
  const ranging = hasAdx && hasAtr && features.adx4h < 20 && features.atrPercentile < 0.6;
  const volatile = hasAtr && features.atrPercentile >= 0.8;

  if (trending) return 'trending';
  if (compressed) return 'compressed';
  if (ranging) return 'ranging';
  if (volatile) return 'volatile';
  return 'unknown';
}

export class RegimeClassifier {
  private readonly byPair = new Map<string, RegimeSnapshot>();

  constructor(private readonly clock: () => number = Date.now) {}

  classify(pair: string, features: RegimeFeatures): RegimeSnapshot {
    const snapshot: RegimeSnapshot = {
      pair,
      regime: classifyRegime(features),
      features,
      classifiedAt: new Date(this.clock()).toISOString(),
    };
    this.byPair.set(pair, snapshot);
    return snapshot;
  }

  current(pair: string): RegimeSnapshot | undefined {
    return this.byPair.get(pair);
  }
}
