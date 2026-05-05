import { join } from 'node:path';
import { loadConfig } from '../config';

export interface MigrateOptions {
  direction: 'up' | 'down';
  databaseUrl?: string;
  count?: number;
}

/** `node-pg-migrate` v8 is ESM-only; tsc/ts-node emit `require()` for `import()` when `module` is CJS. */
async function loadNodePgMigrate(): Promise<typeof import('node-pg-migrate')> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- only way to keep native `import()` from CJS emit
  const load = new Function('return import("node-pg-migrate");') as () => Promise<
    typeof import('node-pg-migrate')
  >;
  return load();
}

export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const databaseUrl = opts.databaseUrl ?? loadConfig().PG_URL;
  const { runner: migrate } = await loadNodePgMigrate();
  await migrate({
    databaseUrl,
    dir: join(__dirname, 'migrations'),
    migrationFileLanguage: 'js',
    migrationsTable: 'pgmigrations',
    direction: opts.direction,
    count: opts.count ?? Infinity,
    log: () => {},
    // One failed migration must not roll back earlier files (avoids half‑applied state +
    // follow-up errors like "relation … does not exist" on repair migrations).
    singleTransaction: false,
  });
}

if (require.main === module) {
  const direction = (process.argv[2] === 'down' ? 'down' : 'up') as 'up' | 'down';
  runMigrations({ direction })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
