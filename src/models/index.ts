export interface Candle {
  m: string; // symbol
  s: string; // status
  f: number; // start time
  t: number; // end time
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface Ticker {
  pair: string;
  last_price: number;
  change_24h: number;
  bid: number;
  ask: number;
}

export interface Position {
  pair: string;
  side: 'buy' | 'sell';
  leverage: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  margin_type: string;
  quantity: number;
}

export interface Balance {
  currency: string;
  balance: number;
  locked_balance: number;
}
