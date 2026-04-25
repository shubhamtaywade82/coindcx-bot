export type Severity = 'info' | 'warn' | 'critical';

export interface Signal {
  id: string;
  ts: string;
  strategy: string;
  type: string;
  pair?: string;
  severity: Severity;
  payload: Record<string, unknown>;
}
