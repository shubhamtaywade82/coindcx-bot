import { describe, it, expect, vi } from 'vitest';
import { ResyncOrchestrator } from '../../../src/marketdata/book/resync';
import { BookManager } from '../../../src/marketdata/book/book-manager';
import { RestBudget } from '../../../src/marketdata/rate-limit/rest-budget';

function makeMgr(): BookManager {
  const m = new BookManager();
  m.onDepthSnapshot('B-SOL_USDT', { asks: [['1','1']], bids: [['0.5','1']], ts: 1 });
  return m;
}

describe('ResyncOrchestrator', () => {
  it('falls back to REST when WS resub times out', async () => {
    const mgr = makeMgr();
    const budget = new RestBudget({ globalPerMin: 10, pairPerMin: 10, timeoutMs: 100 });
    const restFetch = vi.fn(async (_pair: string) => ({
      asks: [['2','2']] as Array<[string,string]>,
      bids: [['1.5','2']] as Array<[string,string]>,
      ts: 99,
    }));
    const wsResub = vi.fn(async (_pair: string) => { /* never sends snapshot */ });

    const orch = new ResyncOrchestrator({
      manager: mgr, budget, restFetch, wsResubscribe: wsResub, wsTimeoutMs: 20,
    });
    const events: any[] = [];
    orch.on('resynced', (e) => events.push(e));

    await orch.requestResync('B-SOL_USDT', 'test');
    expect(restFetch).toHaveBeenCalledWith('B-SOL_USDT');
    expect(mgr.get('B-SOL_USDT')!.bestAsk()?.price).toBe('2');
    expect(events[0].viaRest).toBe(true);
  });

  it('emits failed when budget exhausted', async () => {
    const mgr = makeMgr();
    const budget = new RestBudget({ globalPerMin: 0, pairPerMin: 0, timeoutMs: 0 });
    const orch = new ResyncOrchestrator({
      manager: mgr, budget,
      restFetch: vi.fn(),
      wsResubscribe: vi.fn(),
      wsTimeoutMs: 5,
    });
    const fails: any[] = [];
    orch.on('failed', (e) => fails.push(e));
    await orch.requestResync('B-SOL_USDT', 'test');
    expect(fails.length).toBe(1);
  });
});
