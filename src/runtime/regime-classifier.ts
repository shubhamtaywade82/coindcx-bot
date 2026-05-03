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
  changed: boolean;
  previousRegime?: MarketRegime;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const REGIME_CADENCE_MS = 5 * 60_000;

const REGIME_THRESHOLD = {
  adxTrendingMin: 25,
  adxRangingMax: 20,
  atrVolatileMin: 0.8,
  atrRangingMax: 0.6,
  bbCompressedMax: 0.2,
  bbVolatileMin: 0.75,
} as const;

function normalizePercentile(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value > 1) return value / 100;
  if (value < 0) return 0;
  return value;
}

function evaluateRegimeCandidates(features: RegimeFeatures): Record<'trending' | 'compressed' | 'ranging' | 'volatile', boolean> {
  const hasAdx = isFiniteNumber(features.adx4h);
  const hasAtr = isFiniteNumber(features.atrPercentile);
  const hasBb = isFiniteNumber(features.bbWidthPercentile);
  const adx4h = hasAdx ? features.adx4h : undefined;
  const atrPercentile = normalizePercentile(hasAtr ? features.atrPercentile : undefined);
  const bbWidthPercentile = normalizePercentile(hasBb ? features.bbWidthPercentile : undefined);

  return {
    trending:
      (adx4h !== undefined && adx4h >= REGIME_THRESHOLD.adxTrendingMin) ||
      features.hasMarketStructureShift === true,
    compressed:
      bbWidthPercentile !== undefined &&
      atrPercentile !== undefined &&
      bbWidthPercentile <= REGIME_THRESHOLD.bbCompressedMax &&
      atrPercentile <= 0.5,
    ranging:
      adx4h !== undefined &&
      atrPercentile !== undefined &&
      adx4h <= REGIME_THRESHOLD.adxRangingMax &&
      atrPercentile <= REGIME_THRESHOLD.atrRangingMax,
    volatile:
      (atrPercentile !== undefined && atrPercentile >= REGIME_THRESHOLD.atrVolatileMin) ||
      (bbWidthPercentile !== undefined && bbWidthPercentile >= REGIME_THRESHOLD.bbVolatileMin),
  };
}

export function classifyRegime(features: RegimeFeatures): MarketRegime {
  const candidates = evaluateRegimeCandidates(features);
  const tieBreakOrder: ReadonlyArray<keyof typeof candidates> = [
    'trending',
    'compressed',
    'ranging',
    'volatile',
  ];
  for (const regime of tieBreakOrder) {
    if (candidates[regime]) return regime;
  }
  return 'unknown';
}

export class RegimeClassifier {
  private readonly byPair = new Map<string, RegimeSnapshot>();
  private readonly bucketByPair = new Map<string, number>();

  constructor(private readonly clock: () => number = Date.now) {}

  classify(pair: string, features: RegimeFeatures): RegimeSnapshot {
    const nowMs = this.clock();
    const bucket = Math.floor(nowMs / REGIME_CADENCE_MS);
    const previousBucket = this.bucketByPair.get(pair);
    const existing = this.byPair.get(pair);
    if (existing && previousBucket === bucket) return existing;

    const previousRegime = existing?.regime;
    const regime = classifyRegime(features);
    const snapshot: RegimeSnapshot = {
      pair,
      regime,
      features,
      classifiedAt: new Date(nowMs).toISOString(),
      changed: previousRegime !== undefined && previousRegime !== regime,
      ...(previousRegime !== undefined ? { previousRegime } : {}),
    };
    this.byPair.set(pair, snapshot);
    this.bucketByPair.set(pair, bucket);
    return snapshot;
  }

  current(pair: string): RegimeSnapshot | undefined {
    return this.byPair.get(pair);
  }
}
