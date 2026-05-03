export type BacktestEventKind = 'bar_close' | 'tick' | 'gap';

export interface BacktestEvent {
  ts: number;
  kind: BacktestEventKind;
  pair: string;
  price?: number;
  asks?: Array<[string, string]>;
  bids?: Array<[string, string]>;
  seq?: number;
  prevSeq?: number;
  high?: number;
  low?: number;
  tf?: string;
  raw?: unknown;
  reason?: string;
}

export interface DataSource {
  iterate(): AsyncIterable<BacktestEvent>;
  coverage(): number;
}
