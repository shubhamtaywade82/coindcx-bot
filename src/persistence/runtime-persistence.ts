import type { Pool } from 'pg';
import type { Signal } from '../signals/types';
import type { RoutedOrder } from '../runtime/order-router';

interface RuntimeWrite {
  readonly sql: string;
  readonly params: unknown[];
}

const INSERT_SIGNAL_SQL = `
  INSERT INTO signals (signal_id, ts, strategy, type, pair, severity, payload)
  VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
  ON CONFLICT (signal_id) DO NOTHING
`;

const INSERT_RISK_EVENT_SQL = `
  INSERT INTO risk_events (event_id, ts, strategy, type, pair, severity, payload)
  VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
  ON CONFLICT (event_id) DO NOTHING
`;

const UPSERT_POSITION_SQL = `
  INSERT INTO positions (
    id, pair, side, active_pos, avg_price, mark_price, liquidation_price, leverage,
    margin_currency, unrealized_pnl, realized_pnl, opened_at, updated_at, source
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (id) DO UPDATE SET
    pair = EXCLUDED.pair,
    side = EXCLUDED.side,
    active_pos = EXCLUDED.active_pos,
    avg_price = EXCLUDED.avg_price,
    mark_price = EXCLUDED.mark_price,
    liquidation_price = EXCLUDED.liquidation_price,
    leverage = EXCLUDED.leverage,
    margin_currency = EXCLUDED.margin_currency,
    unrealized_pnl = EXCLUDED.unrealized_pnl,
    realized_pnl = EXCLUDED.realized_pnl,
    opened_at = EXCLUDED.opened_at,
    updated_at = EXCLUDED.updated_at,
    source = EXCLUDED.source
`;

const INSERT_PAPER_TRADE_SQL = `
  INSERT INTO paper_trades (
    id, intent_id, ts, pair, side, entry_type, entry_price, stop_loss, take_profit,
    confidence, strategy_id, created_at, ttl_ms, reason, payload
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
  ON CONFLICT (id) DO NOTHING
`;

function toNumberString(value: unknown): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return '0';
  return String(parsed);
}

export class RuntimePersistence {
  constructor(private readonly pool: Pool) {}

  async persistSignal(signal: Signal): Promise<void> {
    const write = this.signalWrite(signal);
    if (!write) return;
    await this.pool.query(write.sql, write.params);
  }

  async persistRiskEvent(signal: Signal): Promise<void> {
    const write = this.riskEventWrite(signal);
    if (!write) return;
    await this.pool.query(write.sql, write.params);
  }

  async persistPositionSnapshot(signal: Signal): Promise<void> {
    if (signal.type !== 'risk.time_stop_kill') return;
    const payload = signal.payload;
    const positionId = String(payload.positionId ?? signal.id);
    const pair = signal.pair ?? String(payload.pair ?? '');
    if (!pair) return;
    const nowIso = signal.ts;
    const unrealizedPnl = toNumberString(payload.unrealizedPnl ?? 0);
    const activePos = toNumberString(payload.activePos ?? 0);
    const avgPrice = toNumberString(payload.avgPrice ?? payload.entryPrice ?? 0);
    const markPrice = toNumberString(payload.markPrice ?? 0);
    await this.pool.query(UPSERT_POSITION_SQL, [
      positionId,
      pair,
      String(payload.side ?? 'flat').toLowerCase(),
      activePos,
      avgPrice,
      markPrice,
      payload.liquidationPrice ?? null,
      payload.leverage ?? null,
      payload.marginCurrency ?? 'USDT',
      unrealizedPnl,
      payload.realizedPnl ?? '0',
      payload.openedAt ?? null,
      nowIso,
      'ws',
    ]);
  }

  async persistPaperTrade(routedOrder: RoutedOrder): Promise<void> {
    if (routedOrder.route !== 'paper') return;
    await this.pool.query(INSERT_PAPER_TRADE_SQL, [
      routedOrder.intentId,
      routedOrder.intentId,
      routedOrder.routedAt,
      routedOrder.pair,
      routedOrder.side,
      routedOrder.entryType,
      routedOrder.entryPrice ?? null,
      routedOrder.stopLoss,
      routedOrder.takeProfit,
      routedOrder.confidence,
      routedOrder.strategyId,
      routedOrder.createdAt,
      routedOrder.ttlMs,
      routedOrder.reason,
      JSON.stringify({
        route: routedOrder.route,
        metadata: routedOrder.metadata ?? {},
      }),
    ]);
  }

  isSignalEligible(signal: Signal): boolean {
    return this.signalWrite(signal) !== null;
  }

  isRiskEventEligible(signal: Signal): boolean {
    return this.riskEventWrite(signal) !== null;
  }

  private signalWrite(signal: Signal): RuntimeWrite | null {
    if (!signal.type.startsWith('strategy.')) return null;
    return {
      sql: INSERT_SIGNAL_SQL,
      params: [
        signal.id,
        signal.ts,
        signal.strategy,
        signal.type,
        signal.pair ?? null,
        signal.severity,
        JSON.stringify(signal.payload),
      ],
    };
  }

  private riskEventWrite(signal: Signal): RuntimeWrite | null {
    const isRiskSignal = signal.type.startsWith('risk.') || signal.type.startsWith('clock_');
    const isIntegritySignal = signal.strategy === 'integrity';
    const isReconcileSignal = signal.type.startsWith('reconcile.');
    if (!isRiskSignal && !isIntegritySignal && !isReconcileSignal) return null;
    return {
      sql: INSERT_RISK_EVENT_SQL,
      params: [
        signal.id,
        signal.ts,
        signal.strategy,
        signal.type,
        signal.pair ?? null,
        signal.severity,
        JSON.stringify(signal.payload),
      ],
    };
  }
}
