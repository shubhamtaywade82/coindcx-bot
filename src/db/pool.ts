import { Pool } from 'pg';
import { loadConfig } from '../config';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new Pool({ connectionString: cfg.PG_URL, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
