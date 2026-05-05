export interface ResolveMarkPriceInput {
  markPrice?: unknown;
  lastPrice?: unknown;
  avgPrice?: unknown;
}

export interface SyntheticFundingEstimateInput {
  futuresMarkPrice?: unknown;
  spotLastPrice?: unknown;
  intervalHours?: number;
}

export interface SyntheticFundingEstimate {
  basisRatio: number;
  estimatedFundingRate: number;
}

export interface CaptureLiquidationPriceInput {
  observedLiquidationPrice?: unknown;
  previousLiquidationPrice?: string;
}

const DEFAULT_FUNDING_INTERVAL_HOURS = 8;

function toFinite(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function resolveMarkPrice(input: ResolveMarkPriceInput): number | undefined {
  return toFinite(input.markPrice) ?? toFinite(input.lastPrice) ?? toFinite(input.avgPrice);
}

export function estimateSyntheticFundingRate(
  input: SyntheticFundingEstimateInput,
): SyntheticFundingEstimate | undefined {
  const futuresMarkPrice = toFinite(input.futuresMarkPrice);
  const spotLastPrice = toFinite(input.spotLastPrice);
  if (!futuresMarkPrice || !spotLastPrice || spotLastPrice <= 0) {
    return undefined;
  }
  const basisRatio = (futuresMarkPrice - spotLastPrice) / spotLastPrice;
  const intervalHours = Math.max(1, Math.trunc(input.intervalHours ?? DEFAULT_FUNDING_INTERVAL_HOURS));
  const intervalsPerDay = 24 / intervalHours;
  const estimatedFundingRate = basisRatio / intervalsPerDay;
  return {
    basisRatio,
    estimatedFundingRate,
  };
}

const OPEN_INTEREST_KEYS = ['open_interest', 'openInterest', 'oi', 'openInterestValue'] as const;

export function resolveOpenInterest(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const data = raw as Record<string, unknown>;
  for (const key of OPEN_INTEREST_KEYS) {
    const value = toFinite(data[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function captureLiquidationPrice(input: CaptureLiquidationPriceInput): string | undefined {
  const observed = toFinite(input.observedLiquidationPrice);
  if (observed !== undefined) {
    return String(observed);
  }
  return input.previousLiquidationPrice;
}
