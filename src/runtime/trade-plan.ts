import type { IntentMarketContext } from '../execution/intent-validator';
import type { TradeIntent, TradeSide } from '../execution/trade-intent';
import type { ConfluenceScore } from './confluence-scorer';
import type { MarketRegime } from './regime-classifier';

interface TradePlanTargetLadder {
  tp1: number;
  tp2: number;
  tp3: {
    mode: 'chandelier_htf';
    anchor: number;
    atrMultiple: number;
  };
}

export interface TradePlan {
  side: TradeSide;
  entry: number;
  stopLoss: number;
  quantity: number;
  leverage: number;
  riskCapital: number;
  targets: TradePlanTargetLadder;
  breakevenPlus: number;
  liquidationBufferSatisfied: boolean;
  violations: string[];
  metadata: {
    regime: MarketRegime;
    stopDistancePct: number;
    liquidationDistancePct: number;
    highConfluenceGate: number;
    breakevenLockAtR: number;
    negativeCloseAllowedOnlyBy: 'time_stop_kill';
  };
}

export interface TradePlanInput {
  intent: TradeIntent;
  confluence: ConfluenceScore;
  regime: MarketRegime;
  market?: IntentMarketContext;
  accountEquity?: number;
  riskCapitalFraction?: number;
  atrPercent?: number;
  feeRate?: number;
  fundingRate?: number;
  maxVenueLeverage?: number;
}

const DEFAULT_EQUITY = 10_000;
const DEFAULT_RISK_CAPITAL_FRACTION = 0.01;
const DEFAULT_ATR_PERCENT = 0.01;
const DEFAULT_FEE_RATE = 0.001;
const DEFAULT_FUNDING_BUFFER = 0.0005;
const DEFAULT_MAX_VENUE_LEVERAGE = 10;
const HARD_MAX_LEVERAGE = 10;
const LIQUIDATION_DISTANCE_MULTIPLIER = 2;
const TP3_ATR_MULTIPLE = 3;
const HIGH_CONFLUENCE_GATE = 85;
const BREAKEVEN_LOCK_AT_R = 1;

function parsePositive(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseNonNegative(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function dominantSide(score: ConfluenceScore): TradeSide | null {
  if (score.longScore > score.shortScore) return 'LONG';
  if (score.shortScore > score.longScore) return 'SHORT';
  return null;
}

function directionalOffset(side: TradeSide, base: number, distance: number): number {
  return side === 'LONG' ? base + distance : base - distance;
}

function estimateLiquidationPrice(side: TradeSide, entry: number, leverage: number): number {
  return side === 'LONG'
    ? entry * (1 - (1 / leverage))
    : entry * (1 + (1 / leverage));
}

export class TradePlanEngine {
  compute(input: TradePlanInput): TradePlan {
    const violations: string[] = [];
    const scoreDominanceSide = dominantSide(input.confluence);
    const side = scoreDominanceSide ?? input.intent.side;
    if (scoreDominanceSide === null) violations.push('direction_from_score_dominance_unavailable');
    if (side !== input.intent.side) violations.push('intent_side_conflicts_with_score_dominance');

    const entry = parsePositive(input.intent.entryPrice) ??
      parsePositive(input.market?.markPrice) ??
      0;
    if (entry <= 0) violations.push('entry_price_unavailable');

    const structuralStop = parsePositive(input.intent.stopLoss) ?? 0;
    if (structuralStop <= 0) violations.push('structural_invalidation_stop_unavailable');

    const atrPercent = parsePositive(input.atrPercent) ?? DEFAULT_ATR_PERCENT;
    const atrValue = entry * atrPercent;
    const atrBufferedStop = side === 'LONG'
      ? structuralStop - atrValue
      : structuralStop + atrValue;
    const stopLoss = atrBufferedStop > 0 ? atrBufferedStop : structuralStop;
    const riskPerUnit = Math.abs(entry - stopLoss);
    if (riskPerUnit <= 0) violations.push('risk_per_unit_unavailable');

    const accountEquity = parsePositive(input.accountEquity) ?? DEFAULT_EQUITY;
    const riskCapitalFraction = parsePositive(input.riskCapitalFraction) ?? DEFAULT_RISK_CAPITAL_FRACTION;
    const riskCapital = accountEquity * riskCapitalFraction;
    const quantityUncapped = riskPerUnit > 0 ? riskCapital / riskPerUnit : 0;
    const leverageCap = Math.min(
      HARD_MAX_LEVERAGE,
      parsePositive(input.maxVenueLeverage) ??
        parsePositive(input.market?.maxLeverage) ??
        DEFAULT_MAX_VENUE_LEVERAGE,
    );
    const maxNotional = accountEquity * leverageCap;
    const cappedQuantity = entry > 0 ? Math.min(quantityUncapped, maxNotional / entry) : 0;
    const quantity = Math.max(0, cappedQuantity);
    if (quantity <= 0) violations.push('risk_capital_based_quantity_unavailable');
    if (quantityUncapped > cappedQuantity) violations.push('quantity_capped_by_hard_leverage_limit');
    const notional = quantity * entry;
    const leverage = accountEquity > 0 ? Math.max(1, Math.min(leverageCap, notional / accountEquity)) : leverageCap;
    if (leverage > HARD_MAX_LEVERAGE) violations.push('hard_leverage_cap_exceeded');

    const providedLiquidationPrice = parsePositive(input.market?.liquidationPrice);
    const liquidationPrice = providedLiquidationPrice ??
      estimateLiquidationPrice(side, entry, leverage);
    const stopDistancePct = entry > 0 ? (riskPerUnit / entry) : 1;
    const liquidationDistancePct = entry > 0 ? (Math.abs(entry - liquidationPrice) / entry) : 0;
    const liquidationBufferSatisfied = liquidationDistancePct >= (stopDistancePct * LIQUIDATION_DISTANCE_MULTIPLIER);
    if (!liquidationBufferSatisfied) violations.push('liquidation_buffer_rule_failed');

    const tp1 = directionalOffset(side, entry, riskPerUnit);
    const tp2 = directionalOffset(side, entry, riskPerUnit * 3);
    const targets: TradePlanTargetLadder = {
      tp1,
      tp2,
      tp3: {
        mode: 'chandelier_htf',
        anchor: tp2,
        atrMultiple: TP3_ATR_MULTIPLE,
      },
    };

    const feeRate = parseNonNegative(input.feeRate) ?? DEFAULT_FEE_RATE;
    const fundingRate = parseNonNegative(input.fundingRate) ?? DEFAULT_FUNDING_BUFFER;
    const breakevenCarry = entry * ((feeRate * 2) + fundingRate);
    const breakevenPlus = directionalOffset(side, entry, breakevenCarry);

    return {
      side,
      entry,
      stopLoss,
      quantity,
      leverage,
      riskCapital,
      targets,
      breakevenPlus,
      liquidationBufferSatisfied,
      violations,
      metadata: {
        regime: input.regime,
        stopDistancePct,
        liquidationDistancePct,
        highConfluenceGate: HIGH_CONFLUENCE_GATE,
        breakevenLockAtR: BREAKEVEN_LOCK_AT_R,
        negativeCloseAllowedOnlyBy: 'time_stop_kill',
      },
    };
  }
}
