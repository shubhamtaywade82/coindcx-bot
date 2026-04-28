import { describe, it, expect } from 'vitest';
import { Simulator } from '../../../src/strategy/backtest/simulator';

describe('Simulator', () => {
  it('opens a long, hits TP, records trade with positive PnL', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.advanceClock(1000);
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarket(3000, 110);
    const ledger = sim.tradeLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.exitReason).toBe('tp');
    expect(ledger[0]!.pnl).toBeCloseTo(10, 5);
  });

  it('hits SL when price drops below stop, negative PnL', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarket(3000, 94);
    const t = sim.tradeLedger()[0]!;
    expect(t.exitReason).toBe('sl');
    expect(t.pnl).toBeCloseTo(-5, 5);
  });

  it('pessimistic mode picks SL when SL and TP both crossed in same bar', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarketBar(3000, { high: 115, low: 90 });
    expect(sim.tradeLedger()[0]!.exitReason).toBe('sl');
  });

  it('opposite signal closes prior position then opens new', () => {
    const sim = new Simulator({ pair: 'p', pessimistic: true });
    sim.applySignal({ side: 'LONG', confidence: 0.9, entry: '100', stopLoss: '95', takeProfit: '110', reason: 'r' });
    sim.markToMarket(2000, 100);
    sim.markToMarket(3000, 105);
    sim.applySignal({ side: 'SHORT', confidence: 0.9, entry: '105', stopLoss: '110', takeProfit: '100', reason: 'r' });
    sim.markToMarket(4000, 105);
    const ledger = sim.tradeLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.exitReason).toBe('flip');
    expect(sim.openPosition()?.side).toBe('SHORT');
  });
});
