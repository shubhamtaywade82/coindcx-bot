import type { Pool } from 'pg';
import type { Signal } from '../signals/types';

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
