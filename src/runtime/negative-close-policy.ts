export interface NegativeCloseContext {
  side: 'LONG' | 'SHORT';
  unrealizedPnl: number;
  maxConfluenceScore: number;
  breakevenArmed: boolean;
  openedAt?: string;
  nowMs: number;
  timeStopMs: number;
  highConfluenceThreshold: number;
}

export interface NegativeCloseDecision {
  allow: boolean;
  reason:
    | 'positive_pnl_or_flat'
    | 'high_confluence_gate'
    | 'breakeven_lock'
    | 'time_stop_not_reached'
    | 'time_stop_kill';
}

function parseTsMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function shouldAllowNegativeClose(input: NegativeCloseContext): NegativeCloseDecision {
  if (input.unrealizedPnl >= 0) {
    return { allow: true, reason: 'positive_pnl_or_flat' };
  }

  if (input.maxConfluenceScore >= input.highConfluenceThreshold) {
    return { allow: false, reason: 'high_confluence_gate' };
  }

  if (input.breakevenArmed) {
    return { allow: false, reason: 'breakeven_lock' };
  }

  const openedAtMs = parseTsMs(input.openedAt);
  if (openedAtMs === undefined || input.timeStopMs <= 0) {
    return { allow: false, reason: 'time_stop_not_reached' };
  }

  const elapsedMs = input.nowMs - openedAtMs;
  if (elapsedMs < input.timeStopMs) {
    return { allow: false, reason: 'time_stop_not_reached' };
  }

  return { allow: true, reason: 'time_stop_kill' };
}
