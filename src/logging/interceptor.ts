import { type AppLogger } from './logger';

/**
 * Intercepts console methods and redirects them to the logger.
 * This is crucial for TUI applications to prevent background logs from
 * corrupting the terminal screen.
 */
export function interceptConsole(logger: AppLogger) {
  const mod = 'console';

  // Helper to safely format arguments
  const formatArgs = (args: any[]) => {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  };

  /* eslint-disable no-console */
  console.log = (...args: any[]) => {
    logger.info({ mod, source: 'stdout' }, formatArgs(args));
  };

  console.error = (...args: any[]) => {
    logger.error({ mod, source: 'stderr' }, formatArgs(args));
  };

  console.warn = (...args: any[]) => {
    logger.warn({ mod, source: 'stderr' }, formatArgs(args));
  };

  console.info = (...args: any[]) => {
    logger.info({ mod, source: 'stdout' }, formatArgs(args));
  };

  console.debug = (...args: any[]) => {
    logger.debug({ mod, source: 'stdout' }, formatArgs(args));
  };
  /* eslint-enable no-console */
}
