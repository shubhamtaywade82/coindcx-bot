import type { DataSource } from './types';

export type DataSourceKind = 'candles' | 'postgres-fills' | 'jsonl';

export interface DataSourceFactoryArgs {
  kind: DataSourceKind;
  pair: string;
  fromMs: number;
  toMs: number;
  tf?: string;
  jsonlPath?: string;
  pgPool?: any;
  candleFetcher?: (pair: string, tf: string, fromMs: number, toMs: number) => Promise<{ ts: number; o: number; h: number; l: number; c: number }[]>;
}

export async function makeDataSource(_args: DataSourceFactoryArgs): Promise<DataSource> {
  throw new Error('makeDataSource: implement per-kind in subsequent tasks');
}
