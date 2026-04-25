import type { Pool } from 'pg';

export interface CursorRow {
  lastSeq: number;
  lastTs: string;
}

const SELECT_SQL = 'SELECT stream, last_seq, last_ts FROM seq_cursor';
const UPSERT_SQL = `
INSERT INTO seq_cursor (stream, last_seq, last_ts) VALUES ($1, $2, $3)
ON CONFLICT (stream) DO UPDATE SET last_seq = EXCLUDED.last_seq, last_ts = EXCLUDED.last_ts
`;

export class Cursors {
  private cache = new Map<string, CursorRow>();
  constructor(private readonly pool: Pool) {}

  async load(): Promise<void> {
    const r = await this.pool.query(SELECT_SQL);
    this.cache.clear();
    for (const row of r.rows as Array<{ stream: string; last_seq: string; last_ts: string }>) {
      this.cache.set(row.stream, { lastSeq: Number(row.last_seq), lastTs: row.last_ts });
    }
  }

  get(stream: string): CursorRow | undefined {
    return this.cache.get(stream);
  }

  async set(stream: string, lastSeq: number, lastTs: string): Promise<void> {
    await this.pool.query(UPSERT_SQL, [stream, lastSeq, lastTs]);
    this.cache.set(stream, { lastSeq, lastTs });
  }
}
