export type PositionLifecycleState =
  | 'flat'
  | 'entry_submitted'
  | 'entry_filled'
  | 'exit_submitted'
  | 'closed';

export interface PositionStateSnapshot {
  pair: string;
  state: PositionLifecycleState;
  transitionAt: string;
  reason: string;
}

export type PositionEvent =
  | { type: 'intent_routed'; reason: string }
  | { type: 'entry_filled'; reason: string }
  | { type: 'exit_submitted'; reason: string }
  | { type: 'position_closed'; reason: string };

function nextState(current: PositionLifecycleState, event: PositionEvent): PositionLifecycleState {
  switch (event.type) {
    case 'intent_routed':
      return current === 'flat' ? 'entry_submitted' : current;
    case 'entry_filled':
      return current === 'entry_submitted' ? 'entry_filled' : current;
    case 'exit_submitted':
      return current === 'entry_filled' ? 'exit_submitted' : current;
    case 'position_closed':
      return current === 'exit_submitted' ? 'closed' : current;
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
    const currentState = previous?.state ?? 'flat';
    const state = nextState(currentState, event);
    const snapshot: PositionStateSnapshot = {
      pair,
      state,
      transitionAt: new Date(this.clock()).toISOString(),
      reason: event.reason,
    };
    this.byPair.set(pair, snapshot);
    return snapshot;
  }

  current(pair: string): PositionStateSnapshot | undefined {
    return this.byPair.get(pair);
  }
}
