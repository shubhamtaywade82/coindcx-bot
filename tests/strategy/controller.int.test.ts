import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { SignalBus } from '../../src/signals/bus';
import { StrategyController } from '../../src/strategy/controller';
import type { Strategy } from '../../src/strategy/types';

const DOCKER_OFF = process.env.SKIP_DOCKER_TESTS === '1';
const skip = DOCKER_OFF ? describe.skip : describe;
const PG = process.env.PG_URL ?? 'postgres://bot:bot@localhost:5433/coindcx_bot';

const fakeMarket: any = {
  htf: { trend: 'uptrend', swing_high: 1, swing_low: 0 },
  ltf: { trend: 'uptrend', bos: true, swing_high: 1, swing_low: 0,
    displacement: { present: true, strength: 'strong' }, fvg: [],
    mitigation: { status: 'untouched', zone: [0,0] }, inducement: { present: false },
    premium_discount: 'equilibrium' },
  confluence: { aligned: true, narrative: '' },
  liquidity: { pools: [], event: 'none' },
  state: { is_trending: true, is_post_sweep: false, is_pre_expansion: false },
};
const account: any = { positions: [], balances: [], orders: [],
  totals: { equityInr: '0', walletInr: '0', unrealizedInr: '0', realizedDay: '0', realizedLifetime: '0' } };

skip('StrategyController integration', () => {
  let pool: Pool;
  let bus: SignalBus;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    bus = new SignalBus({ pool, sinks: [{ name: 'memory', emit: async () => {} }] });
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query("DELETE FROM signal_log WHERE strategy LIKE 'int-%'");
  });

  function makeStrategy(id: string, side: 'LONG'|'SHORT'|'WAIT'): Strategy {
    return {
      manifest: { id, version: '1', mode: 'interval', intervalMs: 100, pairs: ['p'], description: '' },
      evaluate: () => ({ side, confidence: 0.9, reason: 'r' }),
    };
  }

  it('emits signals to signal_log via SignalBus', async () => {
    const ctrl = new StrategyController({
      ws: new EventEmitter(), signalBus: bus,
      buildMarketState: () => fakeMarket,
      candleProvider: { ltf: () => [], htf: () => [] },
      fusionProvider: () => null,
      accountSnapshot: () => account, recentFills: () => [],
      extractPair: (raw: any) => raw?.pair,
      config: { timeoutMs: 1000, errorThreshold: 3, emitWait: false, backpressureDropRatioAlarm: 0.5 },
    });
    ctrl.register(makeStrategy('int-a', 'LONG'));
    await ctrl.runOnce('int-a', 'p', { kind: 'interval' });
    const r = await pool.query("SELECT * FROM signal_log WHERE strategy='int-a'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.type).toBe('strategy.long');
  });

  it('records strategy.disabled after threshold errors', async () => {
    const ctrl = new StrategyController({
      ws: new EventEmitter(), signalBus: bus,
      buildMarketState: () => fakeMarket,
      candleProvider: { ltf: () => [], htf: () => [] },
      fusionProvider: () => null,
      accountSnapshot: () => account, recentFills: () => [],
      extractPair: (raw: any) => raw?.pair,
      config: { timeoutMs: 1000, errorThreshold: 3, emitWait: false, backpressureDropRatioAlarm: 0.5 },
    });
    ctrl.register({
      manifest: { id: 'int-err', version: '1', mode: 'interval', intervalMs: 100, pairs: ['p'], description: '' },
      evaluate: () => { throw new Error('boom'); },
    });
    for (let i = 0; i < 3; i++) await ctrl.runOnce('int-err', 'p', { kind: 'interval' });
    const r = await pool.query("SELECT type FROM signal_log WHERE strategy='int-err'");
    const types = r.rows.map(x => x.type).sort();
    expect(types).toContain('strategy.disabled');
  });
});
