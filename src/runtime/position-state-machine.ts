export type PositionLifecycleState =
  | 'IDLE'
  | 'SCANNING'
  | 'SIGNAL_DETECTED'
  | 'ENTRY_VALIDATED'
  | 'ORDER_PLACED'
  | 'POSITION_OPEN'
  | 'BREAKEVEN_PROTECTED'
  | 'PARTIAL_TP_HIT'
  | 'TRAILING'
  | 'TIME_STOP_KILL'
  | 'POSITION_CLOSED';

export interface PositionStateSnapshot {
  pair: string;
  state: PositionLifecycleState;
  transitionAt: string;
  reason: string;
  previousState?: PositionLifecycleState;
  ignoredEvent?: boolean;
}

export type PositionEvent =
  | { type: 'scan_started'; reason: string }
  | { type: 'signal_detected'; reason: string }
  | { type: 'entry_validated'; reason: string }
  | { type: 'order_placed'; reason: string }
  | { type: 'entry_filled'; reason: string }
  | { type: 'breakeven_protected'; reason: string }
  | { type: 'partial_tp_hit'; reason: string }
  | { type: 'trailing_started'; reason: string }
  | { type: 'time_stop_kill'; reason: string }
  | { type: 'position_closed'; reason: string };

interface TransitionResult {
  state: PositionLifecycleState;
  ignoredEvent: boolean;
}

function nextState(current: PositionLifecycleState, event: PositionEvent): TransitionResult {
  switch (event.type) {
    case 'scan_started':
      return {
        state: current === 'IDLE' || current === 'POSITION_CLOSED' ? 'SCANNING' : current,
        ignoredEvent: !(current === 'IDLE' || current === 'POSITION_CLOSED'),
      };
    case 'signal_detected':
      return {
        state: current === 'SCANNING' ? 'SIGNAL_DETECTED' : current,
        ignoredEvent: current !== 'SCANNING',
      };
    case 'entry_validated':
      return {
        state: current === 'SIGNAL_DETECTED' ? 'ENTRY_VALIDATED' : current,
        ignoredEvent: current !== 'SIGNAL_DETECTED',
      };
    case 'order_placed':
      return {
        state: current === 'ENTRY_VALIDATED' ? 'ORDER_PLACED' : current,
        ignoredEvent: current !== 'ENTRY_VALIDATED',
      };
    case 'entry_filled':
      return {
        state: current === 'ORDER_PLACED' ? 'POSITION_OPEN' : current,
        ignoredEvent: current !== 'ORDER_PLACED',
      };
    case 'breakeven_protected':
      return {
        state: current === 'POSITION_OPEN' ? 'BREAKEVEN_PROTECTED' : current,
        ignoredEvent: current !== 'POSITION_OPEN',
      };
    case 'partial_tp_hit':
      return {
        state: current === 'BREAKEVEN_PROTECTED' ? 'PARTIAL_TP_HIT' : current,
        ignoredEvent: current !== 'BREAKEVEN_PROTECTED',
      };
    case 'trailing_started':
      return {
        state: current === 'PARTIAL_TP_HIT' ? 'TRAILING' : current,
        ignoredEvent: current !== 'PARTIAL_TP_HIT',
      };
    case 'time_stop_kill':
      return {
        state:
          current === 'POSITION_OPEN' ||
          current === 'BREAKEVEN_PROTECTED' ||
          current === 'PARTIAL_TP_HIT' ||
          current === 'TRAILING'
            ? 'TIME_STOP_KILL'
            : current,
        ignoredEvent: !(
          current === 'POSITION_OPEN' ||
          current === 'BREAKEVEN_PROTECTED' ||
          current === 'PARTIAL_TP_HIT' ||
          current === 'TRAILING'
        ),
      };
    case 'position_closed':
      return {
        state:
          current === 'TIME_STOP_KILL' ||
          current === 'TRAILING' ||
          current === 'PARTIAL_TP_HIT' ||
          current === 'BREAKEVEN_PROTECTED' ||
          current === 'POSITION_OPEN'
            ? 'POSITION_CLOSED'
            : current,
        ignoredEvent: !(
          current === 'TIME_STOP_KILL' ||
          current === 'TRAILING' ||
          current === 'PARTIAL_TP_HIT' ||
          current === 'BREAKEVEN_PROTECTED' ||
          current === 'POSITION_OPEN'
        ),
      };
    default: {
      const neverEvent: never = event;
      throw new Error(`unsupported position event: ${JSON.stringify(neverEvent)}`);
    }
  }
}

export class PositionStateMachine {
  private readonly byPair = new Map<string, PositionStateSnapshot>();

  constructor(private readonly clock: () => number = Date.now) {}

  transition(pair: string, event: PositionEvent): PositionStateSnapshot {
    const previous = this.byPair.get(pair);
    const currentState = previous?.state ?? 'IDLE';
    const next = nextState(currentState, event);
    const snapshot: PositionStateSnapshot = {
      pair,
      state: next.state,
      transitionAt: new Date(this.clock()).toISOString(),
      reason: event.reason,
      ...(currentState !== next.state ? { previousState: currentState } : {}),
      ...(next.ignoredEvent ? { ignoredEvent: true } : {}),
    };
    this.byPair.set(pair, snapshot);
    return snapshot;
  }

  current(pair: string): PositionStateSnapshot | undefined {
    return this.byPair.get(pair);
  }
}
