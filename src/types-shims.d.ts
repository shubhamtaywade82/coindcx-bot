declare module 'pino-roll' {
  const pinoRoll: (opts: Record<string, unknown>) => Promise<NodeJS.WritableStream>;
  export default pinoRoll;
}

declare module 'node-pg-migrate' {
  export interface RunnerOptions {
    databaseUrl: string;
    dir: string;
    migrationsTable: string;
    direction: 'up' | 'down';
    count?: number;
    log?: (msg: string) => void;
    singleTransaction?: boolean;
    migrationFileLanguage?: 'js' | 'ts' | 'sql';
  }
  export function runner(opts: RunnerOptions): Promise<void>;
}
