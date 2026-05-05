export type AuditKind =
  | 'signal'
  | 'alert'
  | 'order_state'
  | 'orderbook_gap'
  | 'orderbook_resync'
  | 'reconcile_diff'
  | 'read_only_violation'
  | 'ws_reconnect'
  | 'telegram_drop'
  | 'fatal'
  | 'boot'
  | 'shutdown'
  | 'periodic_error';

export interface AuditEvent {
  kind: AuditKind;
  source: string;
  seq?: number | null;
  payload: Record<string, unknown>;
}
