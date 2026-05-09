import type { Candle } from '../../ai/state-builder';
import type { Config } from '../../config/schema';
import { displacementFromCandles } from '../displacement';
import { LiquidityPoolRegistry } from './liquidity-pool-registry';
import { atrPercentFromClosed } from './swing-pool-discovery';
import { isActionableScore, isWatchlistScore, scoreRaidEvent } from './scoring';
import type {
  LiquidityEngineConfig,
  LiquidityEngineStepInput,
  LiquidityPool,
  LiquidityRaidActivePublic,
  LiquidityRaidConfirmedPublic,
  LiquidityRaidEvent,
  LiquidityRaidSnapshot,
  RaidEventState,
} from './types';

const PRICE_RING_MAX = 32;

interface PairLiquidityState {
  lastPoolClosedBarTsByTf: Map<string, number>;
  events: Map<string, LiquidityRaidEvent>;
  priceRing: Array<{ ts: number; price: number }>;
  lastConfirmed: LiquidityRaidConfirmedPublic | null;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function newEvent(poolId: string, nowMs: number): LiquidityRaidEvent {
  return {
    id: `${poolId}-${nowMs}`,
    poolId,
    state: 'pending',
    outcome: 'undetermined',
    score: 0,
    scoreBreakdown: {},
    confirmed: false,
    reclaimed: false,
    rejectionSeen: false,
    barsSinceSweep: 0,
    consecutiveAcceptanceBars: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function refPrice(input: LiquidityEngineStepInput): number {
  if (
    input.lastTradePrice !== undefined &&
    Number.isFinite(input.lastTradePrice) &&
    input.lastTradePrice > 0
  ) {
    return input.lastTradePrice;
  }
  const { bestBid, bestAsk, ltpPrice } = input;
  if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
  return ltpPrice;
}

function penetrationPctBuy(poolPrice: number, price: number): number {
  if (poolPrice <= 0) return 0;
  return ((price - poolPrice) / poolPrice) * 100;
}

function penetrationPctSell(poolPrice: number, price: number): number {
  if (poolPrice <= 0) return 0;
  return ((poolPrice - price) / poolPrice) * 100;
}

function volumeSpikeClosed(closed: Candle[], cfg: LiquidityEngineConfig): boolean {
  if (closed.length < cfg.volumeLookbackBars + 2) return false;
  const hist = closed.slice(-(cfg.volumeLookbackBars + 2), -1).map(c => c.volume);
  const avg = mean(hist);
  const lastVol = closed[closed.length - 1]!.volume;
  if (avg <= 0) return false;
  return lastVol > avg * cfg.volumeSpikeMult;
}

function velocityOk(
  ring: Array<{ ts: number; price: number }>,
  ref: number,
  nowMs: number,
  cfg: LiquidityEngineConfig,
): boolean {
  const cutoff = nowMs - cfg.velocityWindowMs;
  let oldest: { ts: number; price: number } | null = null;
  for (const s of ring) {
    if (s.ts >= cutoff && s.ts <= nowMs - 5) {
      if (!oldest || s.ts < oldest.ts) oldest = s;
    }
  }
  if (!oldest || oldest.price <= 0) return false;
  const dtSec = (nowMs - oldest.ts) / 1000;
  if (dtSec < 0.05) return false;
  const pctMove = (Math.abs(ref - oldest.price) / oldest.price) * 100;
  const perSec = pctMove / dtSec;
  return perSec >= cfg.velocityMinPctPerSec;
}

function displacementOpposite1m(
  candles1m: Candle[],
  poolSide: 'buySide' | 'sellSide',
): { opposite: boolean; disp: ReturnType<typeof displacementFromCandles> } {
  const closed = candles1m.slice(0, -1);
  const disp = displacementFromCandles(closed, 10);
  if (closed.length < 1) return { opposite: false, disp };
  const last = closed[closed.length - 1]!;
  const bearishBar = last.close < last.open;
  const bullishBar = last.close > last.open;
  if (poolSide === 'buySide') {
    return { opposite: disp.present && bearishBar, disp };
  }
  return { opposite: disp.present && bullishBar, disp };
}

function penetrationBand(
  closed: Candle[],
  cfg: LiquidityEngineConfig,
): { min: number; max: number } {
  const atrPct = atrPercentFromClosed(closed, 14);
  return {
    min: cfg.minPenetrationPct + atrPct * cfg.penetrationAtrScale * 0.05,
    max: cfg.maxPenetrationPct + atrPct * cfg.penetrationAtrScale * 0.1,
  };
}

function penetrationSweetSpot(pct: number, band: { min: number; max: number }): boolean {
  const sweetMin = Math.max(band.min, 0.08);
  const sweetMax = Math.min(band.max, 0.3);
  return pct >= sweetMin && pct <= sweetMax;
}

export function liquidityEngineConfigFromApp(app: Config): LiquidityEngineConfig {
  return {
    enabled: app.LIQUIDITY_ENGINE_ENABLED,
    poolTimeframes: app.LIQUIDITY_POOL_TIMEFRAMES,
    lookbackBars: app.LIQUIDITY_LOOKBACK_BARS,
    equalClusterFloorPct: app.LIQUIDITY_EQUAL_CLUSTER_FLOOR_PCT,
    equalClusterAtrMult: app.LIQUIDITY_EQUAL_CLUSTER_ATR_MULT,
    poolStrengthDecay: app.LIQUIDITY_POOL_STRENGTH_DECAY,
    maxPoolsPerPair: app.LIQUIDITY_MAX_POOLS_PER_PAIR,
    minPenetrationPct: app.LIQUIDITY_MIN_PENETRATION_PCT,
    maxPenetrationPct: app.LIQUIDITY_MAX_PENETRATION_PCT,
    penetrationAtrScale: app.LIQUIDITY_PENETRATION_ATR_SCALE,
    velocityWindowMs: app.LIQUIDITY_VELOCITY_WINDOW_MS,
    velocityMinPctPerSec: app.LIQUIDITY_VELOCITY_MIN_PCT_PER_SEC,
    volumeSpikeMult: app.LIQUIDITY_VOLUME_SPIKE_MULT,
    volumeLookbackBars: app.LIQUIDITY_VOLUME_LOOKBACK_BARS,
    maxRejectionBars: app.LIQUIDITY_MAX_REJECTION_BARS,
    acceptanceHoldBars: app.LIQUIDITY_ACCEPTANCE_HOLD_BARS,
    eventMaxAgeMs: app.LIQUIDITY_EVENT_MAX_AGE_MS,
    eventMaxBarsSinceSweep: app.LIQUIDITY_EVENT_MAX_BARS_SINCE_SWEEP,
    actionableScoreMin: app.LIQUIDITY_ACTIONABLE_SCORE_MIN,
    watchlistScoreMin: app.LIQUIDITY_WATCHLIST_SCORE_MIN,
    structureMssBonus: app.LIQUIDITY_STRUCTURE_MSS_BONUS,
  };
}

export class LiquidityEngine {
  private readonly registry = new LiquidityPoolRegistry();
  private readonly pairState = new Map<string, PairLiquidityState>();

  constructor(private readonly cfg: LiquidityEngineConfig) {}

  get poolTimeframes(): readonly string[] {
    return this.cfg.poolTimeframes;
  }

  step(input: LiquidityEngineStepInput): LiquidityRaidSnapshot | null {
    if (!this.cfg.enabled) return null;
    const { pair, poolCandlesByTf, ltf1mCandles, swing, nowMs } = input;

    let st = this.pairState.get(pair);
    if (!st) {
      st = {
        lastPoolClosedBarTsByTf: new Map(),
        events: new Map(),
        priceRing: [],
        lastConfirmed: null,
      };
      this.pairState.set(pair, st);
    }

    let anyTfReady = false;
    let advancedAnyBar = false;
    for (const tf of this.cfg.poolTimeframes) {
      const poolCandles = poolCandlesByTf[tf] ?? [];
      if (poolCandles.length < 8) continue;
      anyTfReady = true;
      const closed = poolCandles.slice(0, -1);
      if (closed.length < 5) continue;

      const lastClosedTs = closed[closed.length - 1]!.timestamp;
      const prevTs = st.lastPoolClosedBarTsByTf.get(tf) ?? 0;
      if (lastClosedTs > prevTs) {
        advancedAnyBar = true;
        st.lastPoolClosedBarTsByTf.set(tf, lastClosedTs);
        this.registry.refreshFromClosedForTimeframe(pair, closed, tf, this.cfg);
        this.onNewClosedBar(pair, closed, tf, ltf1mCandles, swing, nowMs, st);
      }
    }

    if (!anyTfReady) {
      return this.emptySnapshot(pair);
    }

    if (!advancedAnyBar) {
      this.registry.tickDecay(pair, this.cfg);
    }

    const ref = refPrice(input);
    st.priceRing.push({ ts: nowMs, price: ref });
    if (st.priceRing.length > PRICE_RING_MAX) {
      st.priceRing.splice(0, st.priceRing.length - PRICE_RING_MAX);
    }

    const pools = this.registry.getPools(pair);
    for (const pool of pools) {
      if (pool.status === 'invalidated') continue;
      const poolCandles = poolCandlesByTf[pool.timeframe] ?? [];
      if (poolCandles.length < 8) continue;
      const closed = poolCandles.slice(0, -1);
      if (closed.length < 5) continue;
      const band = penetrationBand(closed, this.cfg);
      const volSpike = volumeSpikeClosed(closed, this.cfg);
      const velOk = velocityOk(st.priceRing, ref, nowMs, this.cfg);
      this.processPoolIntrabar(pool, ref, closed, volSpike, velOk, band, nowMs, st, input);
    }

    this.pruneStaleEvents(st, nowMs);

    return this.buildSnapshot(pair, pools, st);
  }

  private emptySnapshot(pair: string): LiquidityRaidSnapshot {
    void pair;
    const tfs = [...this.cfg.poolTimeframes];
    return {
      enabled: true,
      poolTimeframes: tfs,
      timeframe: tfs.join('+'),
      pools: [],
      activeEvent: null,
      lastConfirmed: null,
    };
  }

  private onNewClosedBar(
    pair: string,
    closed: Candle[],
    tf: string,
    ltf1m: Candle[],
    swing: LiquidityEngineStepInput['swing'],
    nowMs: number,
    st: PairLiquidityState,
  ): void {
    const lastBar = closed[closed.length - 1]!;
    const poolIds = Array.from(st.events.keys());
    for (const poolId of poolIds) {
      const ev = st.events.get(poolId);
      if (!ev || ev.state !== 'swept') continue;
      const pool = this.registry.getPools(pair).find(p => p.id === poolId);
      if (!pool) {
        st.events.delete(poolId);
        continue;
      }
      if (pool.timeframe !== tf) continue;
      ev.barsSinceSweep += 1;
      ev.updatedAtMs = nowMs;

      if (pool.side === 'buySide') {
        if (lastBar.close > pool.price) {
          ev.consecutiveAcceptanceBars += 1;
        } else {
          ev.consecutiveAcceptanceBars = 0;
        }
        if (ev.consecutiveAcceptanceBars >= this.cfg.acceptanceHoldBars) {
          ev.state = 'invalidated';
          ev.outcome = 'breakoutContinuation';
          pool.status = 'invalidated';
          st.events.delete(poolId);
          continue;
        }
        const rejection = lastBar.high > pool.price && lastBar.close < pool.price;
        if (rejection) ev.rejectionSeen = true;

        const { opposite } = displacementOpposite1m(ltf1m, pool.side);
        if (ev.rejectionSeen && opposite) {
          const band = penetrationBand(closed, this.cfg);
          const { total, breakdown } = scoreRaidEvent({
            pool,
            event: ev,
            cfg: this.cfg,
            swing,
            displacementOpposite: opposite,
            penetrationSweetSpot: penetrationSweetSpot(ev.maxPenetrationPct ?? 0, band),
            volumeSpike: volumeSpikeClosed(closed, this.cfg),
            freshPool: nowMs - pool.createdAtBarTs < 1_800_000,
          });
          ev.score = total;
          ev.scoreBreakdown = breakdown;
          ev.state = 'confirmed';
          ev.confirmed = true;
          ev.outcome = 'reversalCandidate';
          if (total >= this.cfg.watchlistScoreMin) {
            const actionable = isActionableScore(total, this.cfg);
            st.lastConfirmed = {
              poolId: pool.id,
              timeframe: pool.timeframe,
              side: pool.side,
              poolPrice: pool.price,
              outcome: ev.outcome,
              score: total,
              atMs: nowMs,
              actionable,
              watchlistQuality: isWatchlistScore(total, this.cfg),
            };
          }
          st.events.delete(poolId);
          continue;
        }
      } else {
        if (lastBar.close < pool.price) {
          ev.consecutiveAcceptanceBars += 1;
        } else {
          ev.consecutiveAcceptanceBars = 0;
        }
        if (ev.consecutiveAcceptanceBars >= this.cfg.acceptanceHoldBars) {
          ev.state = 'invalidated';
          ev.outcome = 'breakoutContinuation';
          pool.status = 'invalidated';
          st.events.delete(poolId);
          continue;
        }
        const rejection = lastBar.low < pool.price && lastBar.close > pool.price;
        if (rejection) ev.rejectionSeen = true;

        const { opposite } = displacementOpposite1m(ltf1m, pool.side);
        if (ev.rejectionSeen && opposite) {
          const band = penetrationBand(closed, this.cfg);
          const { total, breakdown } = scoreRaidEvent({
            pool,
            event: ev,
            cfg: this.cfg,
            swing,
            displacementOpposite: opposite,
            penetrationSweetSpot: penetrationSweetSpot(ev.maxPenetrationPct ?? 0, band),
            volumeSpike: volumeSpikeClosed(closed, this.cfg),
            freshPool: nowMs - pool.createdAtBarTs < 1_800_000,
          });
          ev.score = total;
          ev.scoreBreakdown = breakdown;
          ev.state = 'confirmed';
          ev.confirmed = true;
          ev.outcome = 'reversalCandidate';
          if (total >= this.cfg.watchlistScoreMin) {
            const actionable = isActionableScore(total, this.cfg);
            st.lastConfirmed = {
              poolId: pool.id,
              timeframe: pool.timeframe,
              side: pool.side,
              poolPrice: pool.price,
              outcome: ev.outcome,
              score: total,
              atMs: nowMs,
              actionable,
              watchlistQuality: isWatchlistScore(total, this.cfg),
            };
          }
          st.events.delete(poolId);
          continue;
        }
      }

      if (ev.barsSinceSweep > this.cfg.maxRejectionBars && ev.state === 'swept') {
        ev.state = 'invalidated';
        ev.outcome = 'undetermined';
        st.events.delete(poolId);
      }
    }
  }

  private processPoolIntrabar(
    pool: LiquidityPool,
    ref: number,
    closed: Candle[],
    volSpike: boolean,
    velOk: boolean,
    band: { min: number; max: number },
    nowMs: number,
    st: PairLiquidityState,
    input: LiquidityEngineStepInput,
  ): void {
    let ev = st.events.get(pool.id);
    const touchBuy = ref >= pool.price;
    const touchSell = ref <= pool.price;
    const penBuy = penetrationPctBuy(pool.price, ref);
    const penSell = penetrationPctSell(pool.price, ref);
    const pen = pool.side === 'buySide' ? penBuy : penSell;

    if (!ev) {
      const touchedNow = pool.side === 'buySide' ? touchBuy : touchSell;
      if (touchedNow) {
        ev = newEvent(pool.id, nowMs);
        ev.state = 'touched';
        ev.touchTimeMs = nowMs;
        ev.touchPrice = ref;
        st.events.set(pool.id, ev);
        this.registry.touchPool(input.pair, pool.id);
      }
      return;
    }

    if (ev.state === 'confirmed' || ev.state === 'invalidated') {
      st.events.delete(pool.id);
      return;
    }

    ev.updatedAtMs = nowMs;

    if (ev.state === 'pending') {
      if (pool.side === 'buySide' ? touchBuy : touchSell) {
        ev.state = 'touched';
        ev.touchTimeMs = nowMs;
        ev.touchPrice = ref;
        this.registry.touchPool(input.pair, pool.id);
      }
      return;
    }

    if (ev.state === 'touched') {
      if (pool.side === 'buySide' && ref < pool.price * 0.995) {
        st.events.delete(pool.id);
        return;
      }
      if (pool.side === 'sellSide' && ref > pool.price * 1.005) {
        st.events.delete(pool.id);
        return;
      }
      ev.maxPenetrationPct = Math.max(ev.maxPenetrationPct ?? 0, pen);
      if (pen >= band.min && pen <= band.max && volSpike && velOk) {
        ev.state = 'swept';
        ev.sweepTimeMs = nowMs;
        ev.sweepPrice = ref;
        ev.barsSinceSweep = 0;
        ev.consecutiveAcceptanceBars = 0;
        ev.rejectionSeen = false;
      }
      if (nowMs - (ev.touchTimeMs ?? nowMs) > this.cfg.eventMaxAgeMs) {
        st.events.delete(pool.id);
      }
      return;
    }

    if (ev.state === 'swept') {
      ev.maxPenetrationPct = Math.max(ev.maxPenetrationPct ?? 0, pen);
      if (ev.barsSinceSweep > this.cfg.eventMaxBarsSinceSweep) {
        st.events.delete(pool.id);
      }
    }
  }

  private pruneStaleEvents(st: PairLiquidityState, nowMs: number): void {
    for (const [id, ev] of st.events) {
      if (nowMs - ev.createdAtMs > this.cfg.eventMaxAgeMs) {
        st.events.delete(id);
      }
    }
  }

  private buildSnapshot(
    pair: string,
    pools: LiquidityPool[],
    st: PairLiquidityState,
  ): LiquidityRaidSnapshot {
    void pair;
    const poolsPub = pools
      .filter(p => p.status !== 'invalidated')
      .map(p => ({
        id: p.id,
        side: p.side,
        price: p.price,
        strength: p.strength,
        touches: p.touches,
        timeframe: p.timeframe,
        status: p.status,
      }));

    const activeCandidates: Array<LiquidityRaidActivePublic & { sweepTimeMs: number }> = [];
    for (const [poolId, ev] of st.events) {
      if (ev.state === 'pending') continue;
      const pool = pools.find(p => p.id === poolId);
      if (!pool) continue;
      activeCandidates.push({
        poolId,
        timeframe: pool.timeframe,
        side: pool.side,
        poolPrice: pool.price,
        state: ev.state as RaidEventState,
        maxPenetrationPct: ev.maxPenetrationPct,
        score: ev.score,
        outcome: ev.outcome,
        sweepTimeMs: ev.sweepTimeMs ?? 0,
      });
    }
    const active = activeCandidates.sort((a, b) => b.score - a.score || b.sweepTimeMs - a.sweepTimeMs)[0] ?? null;

    const activePublic: LiquidityRaidActivePublic | null = active
      ? {
          poolId: active.poolId,
          timeframe: active.timeframe,
          side: active.side,
          poolPrice: active.poolPrice,
          state: active.state,
          maxPenetrationPct: active.maxPenetrationPct,
          score: active.score,
          outcome: active.outcome,
        }
      : null;

    const tfs = [...this.cfg.poolTimeframes];
    return {
      enabled: true,
      poolTimeframes: tfs,
      timeframe: tfs.join('+'),
      pools: poolsPub,
      activeEvent: activePublic,
      lastConfirmed: st.lastConfirmed,
    };
  }
}
