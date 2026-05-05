import { describe, expect, it } from 'vitest';
import { PositionStateMachine } from '../../src/runtime/position-state-machine';

describe('PositionStateMachine B6 formal flow', () => {
  it('transitions through formal happy-path states', () => {
    const machine = new PositionStateMachine(() => Date.parse('2026-05-03T12:00:00.000Z'));
    expect(machine.transition('B-BTC_USDT', { type: 'scan_started', reason: 'scan' }).state).toBe('SCANNING');
    expect(machine.transition('B-BTC_USDT', { type: 'signal_detected', reason: 'signal' }).state).toBe('SIGNAL_DETECTED');
    expect(machine.transition('B-BTC_USDT', { type: 'entry_validated', reason: 'validated' }).state).toBe('ENTRY_VALIDATED');
    expect(machine.transition('B-BTC_USDT', { type: 'order_placed', reason: 'placed' }).state).toBe('ORDER_PLACED');
    expect(machine.transition('B-BTC_USDT', { type: 'entry_filled', reason: 'filled' }).state).toBe('POSITION_OPEN');
    expect(machine.transition('B-BTC_USDT', { type: 'breakeven_protected', reason: 'be' }).state).toBe('BREAKEVEN_PROTECTED');
    expect(machine.transition('B-BTC_USDT', { type: 'partial_tp_hit', reason: 'tp1' }).state).toBe('PARTIAL_TP_HIT');
    expect(machine.transition('B-BTC_USDT', { type: 'trailing_started', reason: 'trail' }).state).toBe('TRAILING');
    expect(machine.transition('B-BTC_USDT', { type: 'position_closed', reason: 'closed' }).state).toBe('POSITION_CLOSED');
  });

  it('supports time-stop-kill side path', () => {
    const machine = new PositionStateMachine();
    machine.transition('B-BTC_USDT', { type: 'scan_started', reason: 'scan' });
    machine.transition('B-BTC_USDT', { type: 'signal_detected', reason: 'signal' });
    machine.transition('B-BTC_USDT', { type: 'entry_validated', reason: 'validated' });
    machine.transition('B-BTC_USDT', { type: 'order_placed', reason: 'placed' });
    machine.transition('B-BTC_USDT', { type: 'entry_filled', reason: 'filled' });
    const kill = machine.transition('B-BTC_USDT', { type: 'time_stop_kill', reason: 'timeout' });
    expect(kill.state).toBe('TIME_STOP_KILL');
    const closed = machine.transition('B-BTC_USDT', { type: 'position_closed', reason: 'flat' });
    expect(closed.state).toBe('POSITION_CLOSED');
  });

  it('marks invalid out-of-order transitions as ignored', () => {
    const machine = new PositionStateMachine();
    const snap = machine.transition('B-BTC_USDT', { type: 'entry_filled', reason: 'invalid order' });
    expect(snap.state).toBe('IDLE');
    expect(snap.ignoredEvent).toBe(true);
  });
});
