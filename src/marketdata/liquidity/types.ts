import type { Candle } from '../../ai/state-builder';
import type { TradeMetrics } from '../trade-flow';
import type { SwingIndicators } from '../swing-indicators';

export type LiquidityPoolSide = 'buySide' | 'sellSide';

export type LiquidityPoolStatus = 'active' | 'weakened' | 'invalidated';

export type RaidEventState = 'pending' | 'touched' | 'swept' | 'confirmed' | 'invalidated';

export type RaidOutcome = 'reversalCandidate' | 'breakoutContinuation' | 'undetermined';

export interface LiquidityPool {
  id: string;
  side: LiquidityPoolSide;
  price: number;
  createdAtBarTs: number;
  strength: number;
  touches: number;
  timeframe: string;
  status: LiquidityPoolStatus;
  pivotCount: number;
}

export interface LiquidityRaidEvent {
  id: string;
  poolId: string;
  state: RaidEventState;
  sweepPrice?: number;
  sweepTimeMs?: number;
  touchTimeMs?: number;
  touchPrice?: number;
  maxPenetrationPct?: number;
  outcome: RaidOutcome;
  score: number;
  scoreBreakdown: Record<string, number>;
  confirmed: boolean;
  reclaimed: boolean;
  /** Wick raid + close back inside seen on at least one closed pool-TF bar. */
  rejectionSeen: boolean;
  barsSinceSweep: number;
  consecutiveAcceptanceBars: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LiquidityRaidPoolPublic {
  id: string;
  side: LiquidityPoolSide;
  price: number;
  strength: number;
  touches: number;
  timeframe: string;
  status: LiquidityPoolStatus;
}

export interface LiquidityRaidActivePublic {
  poolId: string;
  timeframe: string;
  side: LiquidityPoolSide;
  poolPrice: number;
  state: RaidEventState;
  maxPenetrationPct?: number;
  score: number;
  outcome: RaidOutcome;
}

export interface LiquidityRaidConfirmedPublic {
  poolId: string;
  /** Candle timeframe this pool was derived from. */
  timeframe: string;
  side: LiquidityPoolSide;
  poolPrice: number;
  outcome: RaidOutcome;
  score: number;
  atMs: number;
  /** True when score meets LIQUIDITY_ACTIONABLE_SCORE_MIN. */
  actionable: boolean;
  /** True when score is in [LIQUIDITY_WATCHLIST_SCORE_MIN, LIQUIDITY_ACTIONABLE_SCORE_MIN). */
  watchlistQuality: boolean;
}

export interface LiquidityRaidSnapshot {
  enabled: true;
  /** Pool discovery / sweep timeframes (engine config). */
  poolTimeframes: string[];
  /** Joined list for compact display (same order as config). */
  timeframe: string;
  pools: LiquidityRaidPoolPublic[];
  activeEvent: LiquidityRaidActivePublic | null;
  /** Most recent structural confirm (reversal + opposite displacement); may be non-actionable score. */
  lastConfirmed: LiquidityRaidConfirmedPublic | null;
}

export interface LiquidityEngineConfig {
  enabled: boolean;
  /** Pool discovery runs on each listed timeframe (e.g. 5m + 15m + 1h + 4h). */
  poolTimeframes: string[];
  lookbackBars: number;
  equalClusterFloorPct: number;
  equalClusterAtrMult: number;
  poolStrengthDecay: number;
  maxPoolsPerPair: number;
  minPenetrationPct: number;
  maxPenetrationPct: number;
  penetrationAtrScale: number;
  velocityWindowMs: number;
  velocityMinPctPerSec: number;
  volumeSpikeMult: number;
  volumeLookbackBars: number;
  maxRejectionBars: number;
  acceptanceHoldBars: number;
  eventMaxAgeMs: number;
  eventMaxBarsSinceSweep: number;
  actionableScoreMin: number;
  watchlistScoreMin: number;
  structureMssBonus: boolean;
}

export interface LiquidityEngineStepInput {
  pair: string;
  /** Closed+forming series per pool timeframe (keys must cover `cfg.poolTimeframes`). */
  poolCandlesByTf: Record<string, Candle[]>;
  ltf1mCandles: Candle[];
  bestBid: number;
  bestAsk: number;
  ltpPrice: number;
  lastTradePrice?: number;
  tradeMetrics?: TradeMetrics | null;
  swing: SwingIndicators;
  nowMs: number;
}
