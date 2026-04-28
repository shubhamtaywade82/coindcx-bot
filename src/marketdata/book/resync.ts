import { EventEmitter } from 'node:events';
import type { BookManager, DepthFrame } from './book-manager';
import { RestBudget, RestBudgetExhausted } from '../rate-limit/rest-budget';

export interface ResyncOptions {
  manager: BookManager;
  budget: RestBudget;
  restFetch: (pair: string) => Promise<DepthFrame>;
  wsResubscribe: (pair: string) => Promise<void>;
  wsTimeoutMs: number;
}

export class ResyncOrchestrator extends EventEmitter {
  private inFlight = new Set<string>();

  constructor(private readonly opts: ResyncOptions) { super(); }

  async requestResync(pair: string, reason: string): Promise<void> {
    if (this.inFlight.has(pair)) return;
    this.inFlight.add(pair);
    const started = Date.now();
    try {
      const book = this.opts.manager.get(pair);
      if (book) book.setState('resyncing');

      const snapshotReceived = new Promise<DepthFrame | null>((resolve) => {
        const onSnap = (p: string, frame: DepthFrame) => {
          if (p === pair) {
            this.opts.manager.off('snapshotReceived', onSnap);
            resolve(frame);
          }
        };
        this.opts.manager.on('snapshotReceived', onSnap);
        setTimeout(() => {
          this.opts.manager.off('snapshotReceived', onSnap);
          resolve(null);
        }, this.opts.wsTimeoutMs);
      });
      await this.opts.wsResubscribe(pair);
      const wsFrame = await snapshotReceived;
      if (wsFrame) {
        this.emit('resynced', { pair, reason, viaRest: false, durationMs: Date.now() - started });
        return;
      }

      try {
        await this.opts.budget.acquire(pair);
      } catch (err) {
        if (err instanceof RestBudgetExhausted) {
          this.emit('failed', { pair, reason, error: 'budget_exhausted' });
          return;
        }
        throw err;
      }

      const frame = await this.opts.restFetch(pair);
      this.opts.manager.onDepthSnapshot(pair, frame);
      this.emit('resynced', { pair, reason, viaRest: true, durationMs: Date.now() - started });
    } catch (err) {
      this.emit('failed', { pair, reason, error: (err as Error).message });
    } finally {
      this.inFlight.delete(pair);
    }
  }
}
