import type { Pool } from 'pg';
import type { Sink } from '../sinks/types';
import type { Signal } from './types';

export interface SignalBusOptions {
  sinks: Sink[];
  pool: Pool;
  onSinkError?: (sinkName: string, err: Error) => void;
  onPersistError?: (err: Error) => void;
}

const INSERT_SQL =
  'INSERT INTO signal_log (ts, strategy, type, pair, severity, payload) VALUES ($1,$2,$3,$4,$5,$6)';

export class SignalBus {
  constructor(private readonly opts: SignalBusOptions) {}

  async emit(signal: Signal): Promise<void> {
    const persist = this.persist(signal);
    const fanout = Promise.allSettled(this.opts.sinks.map((s) => s.emit(signal)));
    const [, results] = await Promise.all([persist, fanout]);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'rejected') {
        this.opts.onSinkError?.(this.opts.sinks[i]!.name, r.reason as Error);
      }
    }
  }

  private async persist(s: Signal): Promise<void> {
    try {
      await this.opts.pool.query(INSERT_SQL, [
        s.ts, s.strategy, s.type, s.pair ?? null, s.severity, JSON.stringify(s.payload),
      ]);
    } catch (err) {
      this.opts.onPersistError?.(err as Error);
    }
  }
}
