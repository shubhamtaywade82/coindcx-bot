export type Channel =
  | 'depth-snapshot'
  | 'depth-update'
  | 'new-trade'
  | 'currentPrices@futures#update'
  | 'currentPrices@spot#update';

export type BookState = 'init' | 'live' | 'resyncing' | 'broken';

export interface PriceLevel { price: string; qty: string }

export interface RawFrame {
  ts: number;
  channel: Channel;
  raw: unknown;
}

export interface BookTopN { asks: PriceLevel[]; bids: PriceLevel[] }
