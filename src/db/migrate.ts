import { runner as migrate } from 'node-pg-migrate';
import { join } from 'node:path';
import { loadConfig } from '../config';

export interface MigrateOptions {
  direction: 'up' | 'down';
  databaseUrl?: string;
  count?: number;
}

export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const databaseUrl = opts.databaseUrl ?? loadConfig().PG_URL;
  await migrate({
    databaseUrl,
    dir: join(__dirname, 'migrations'),
    migrationFileLanguage: 'js',
    migrationsTable: 'pgmigrations',
    direction: opts.direction,
    count: opts.count ?? Infinity,
    log: () => {},
    singleTransaction: true,
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
