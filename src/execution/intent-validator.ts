import type { TradeIntent, TradeSide } from './trade-intent';
import { isTradeSide } from './trade-intent';

export type IntentRejectionCode =
  | 'missing_pair'
  | 'invalid_side'
  | 'invalid_entry_type'
  | 'missing_entry_price'
  | 'missing_stop_loss'
  | 'missing_take_profit'
  | 'invalid_price'
  | 'invalid_confidence'
  | 'invalid_ttl'
  | 'invalid_created_at'
  | 'expired_intent'
  | 'invalid_long_levels'
  | 'invalid_short_levels'
  | 'reward_risk_too_low'
  | 'stop_distance_too_small'
  | 'stop_distance_too_large'
  | 'spread_too_wide'
  | 'market_data_stale'
  | 'account_state_stale'
  | 'account_divergent';

export interface IntentRejection {
  code: IntentRejectionCode;
  message: string;
}

export interface IntentMarketContext {
  markPrice?: string | number;
  bestBid?: string | number;
  bestAsk?: string | number;
  marketDataFresh?: boolean;
  accountStateFresh?: boolean;
  accountDivergent?: boolean;
}

export interface IntentValidatorOptions {
  nowMs?: number;
  minRewardRisk?: number;
  minStopDistancePct?: number;
  maxStopDistancePct?: number;
  maxSpreadPct?: number;
}

export interface IntentValidationInput {
  intent: TradeIntent;
  market?: IntentMarketContext;
  options?: IntentValidatorOptions;
}

export interface ApprovedTradeIntent extends TradeIntent {
  side: TradeSide;
  resolvedEntryPrice: string;
  metrics: {
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rewardRisk: number;
    stopDistancePct: number;
    takeProfitDistancePct: number;
    spreadPct?: number;
  };
}

export type IntentValidationDecision =
  | { approved: true; intent: ApprovedTradeIntent }
  | { approved: false; rejections: IntentRejection[] };

const DEFAULT_MIN_REWARD_RISK = 1.5;
const DEFAULT_MIN_STOP_DISTANCE_PCT = 0.0005;
const DEFAULT_MAX_STOP_DISTANCE_PCT = 0.08;
const DEFAULT_MAX_SPREAD_PCT = 0.002;

function reject(code: IntentRejectionCode, message: string): IntentRejection {
  return { code, message };
}

function parseFinitePrice(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveEntryPrice(intent: TradeIntent, market?: IntentMarketContext): number | null {
  const explicit = parseFinitePrice(intent.entryPrice);
  if (explicit !== null) return explicit;

  const mark = parseFinitePrice(market?.markPrice);
  if (mark !== null) return mark;

  const bid = parseFinitePrice(market?.bestBid);
  const ask = parseFinitePrice(market?.bestAsk);
  if (bid !== null && ask !== null && ask >= bid) return (bid + ask) / 2;

  return null;
}

function spreadPct(market?: IntentMarketContext): number | undefined {
  const bid = parseFinitePrice(market?.bestBid);
  const ask = parseFinitePrice(market?.bestAsk);
  if (bid === null || ask === null || ask < bid) return undefined;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return undefined;
  return (ask - bid) / mid;
}

function levelMetrics(side: TradeSide, entry: number, stopLoss: number, takeProfit: number) {
  const risk = side === 'LONG' ? entry - stopLoss : stopLoss - entry;
  const reward = side === 'LONG' ? takeProfit - entry : entry - takeProfit;
  return {
    risk,
    reward,
    rewardRisk: reward / risk,
    stopDistancePct: risk / entry,
    takeProfitDistancePct: reward / entry,
  };
}

export function validateTradeIntent(input: IntentValidationInput): IntentValidationDecision {
  const { intent, market } = input;
  const options = input.options ?? {};
  const nowMs = options.nowMs ?? Date.now();
  const minRewardRisk = options.minRewardRisk ?? DEFAULT_MIN_REWARD_RISK;
  const minStopDistancePct = options.minStopDistancePct ?? DEFAULT_MIN_STOP_DISTANCE_PCT;
  const maxStopDistancePct = options.maxStopDistancePct ?? DEFAULT_MAX_STOP_DISTANCE_PCT;
  const maxSpreadPct = options.maxSpreadPct ?? DEFAULT_MAX_SPREAD_PCT;
  const rejections: IntentRejection[] = [];

  if (!intent.pair.trim()) rejections.push(reject('missing_pair', 'pair is required'));
  if (!isTradeSide(intent.side)) rejections.push(reject('invalid_side', 'side must be LONG or SHORT'));
  if (intent.entryType !== 'market' && intent.entryType !== 'limit') {
    rejections.push(reject('invalid_entry_type', 'entryType must be market or limit'));
  }
  if (!Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 1) {
    rejections.push(reject('invalid_confidence', 'confidence must be between 0 and 1'));
  }
  if (!Number.isFinite(intent.ttlMs) || intent.ttlMs <= 0) {
    rejections.push(reject('invalid_ttl', 'ttlMs must be positive'));
  }

  const createdAtMs = Date.parse(intent.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    rejections.push(reject('invalid_created_at', 'createdAt must be a valid timestamp'));
  } else if (Number.isFinite(intent.ttlMs) && nowMs - createdAtMs > intent.ttlMs) {
    rejections.push(reject('expired_intent', 'trade intent has expired'));
  }

  if (market?.marketDataFresh === false) {
    rejections.push(reject('market_data_stale', 'market data is stale'));
  }
  if (market?.accountStateFresh === false) {
    rejections.push(reject('account_state_stale', 'account state is stale'));
  }
  if (market?.accountDivergent === true) {
    rejections.push(reject('account_divergent', 'account state is divergent'));
  }

  const entryPrice = resolveEntryPrice(intent, market);
  const stopLoss = parseFinitePrice(intent.stopLoss);
  const takeProfit = parseFinitePrice(intent.takeProfit);

  if (entryPrice === null) rejections.push(reject('missing_entry_price', 'entry price or market reference price is required'));
  if (intent.stopLoss === '') rejections.push(reject('missing_stop_loss', 'stop loss is required'));
  if (intent.takeProfit === '') rejections.push(reject('missing_take_profit', 'take profit is required'));
  if (intent.stopLoss !== '' && stopLoss === null) rejections.push(reject('invalid_price', 'stop loss must be a positive finite number'));
  if (intent.takeProfit !== '' && takeProfit === null) rejections.push(reject('invalid_price', 'take profit must be a positive finite number'));

  const sp = spreadPct(market);
  if (sp !== undefined && sp > maxSpreadPct) {
    rejections.push(reject('spread_too_wide', `spread ${(sp * 100).toFixed(3)}% exceeds max ${(maxSpreadPct * 100).toFixed(3)}%`));
  }

  if (!isTradeSide(intent.side) || entryPrice === null || stopLoss === null || takeProfit === null) {
    return { approved: false, rejections };
  }

  if (intent.side === 'LONG' && !(stopLoss < entryPrice && entryPrice < takeProfit)) {
    rejections.push(reject('invalid_long_levels', 'LONG requires stopLoss < entry < takeProfit'));
  }
  if (intent.side === 'SHORT' && !(takeProfit < entryPrice && entryPrice < stopLoss)) {
    rejections.push(reject('invalid_short_levels', 'SHORT requires takeProfit < entry < stopLoss'));
  }

  const metrics = levelMetrics(intent.side, entryPrice, stopLoss, takeProfit);
  if (Number.isFinite(metrics.rewardRisk) && metrics.rewardRisk < minRewardRisk) {
    rejections.push(reject('reward_risk_too_low', `reward:risk ${metrics.rewardRisk.toFixed(2)} is below ${minRewardRisk.toFixed(2)}`));
  }
  if (Number.isFinite(metrics.stopDistancePct) && metrics.stopDistancePct < minStopDistancePct) {
    rejections.push(reject('stop_distance_too_small', `stop distance ${(metrics.stopDistancePct * 100).toFixed(3)}% is below minimum`));
  }
  if (Number.isFinite(metrics.stopDistancePct) && metrics.stopDistancePct > maxStopDistancePct) {
    rejections.push(reject('stop_distance_too_large', `stop distance ${(metrics.stopDistancePct * 100).toFixed(3)}% exceeds maximum`));
  }

  if (rejections.length > 0) return { approved: false, rejections };

  return {
    approved: true,
    intent: {
      ...intent,
      resolvedEntryPrice: String(entryPrice),
      metrics: {
        entryPrice,
        stopLoss,
        takeProfit,
        rewardRisk: metrics.rewardRisk,
        stopDistancePct: metrics.stopDistancePct,
        takeProfitDistancePct: metrics.takeProfitDistancePct,
        spreadPct: sp,
      },
    },
  };
}
