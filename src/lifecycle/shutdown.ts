import type { Context } from './context';
import { closePool } from '../db/pool';

export async function shutdown(ctx: Context, signal: string): Promise<void> {
  ctx.logger.info({ mod: 'shutdown', signal }, 'shutdown start');
  ctx.audit.recordEvent({ kind: 'shutdown', source: 'lifecycle', payload: { signal } });

  const grace = ctx.config.SHUTDOWN_GRACE_MS;
  if (ctx.runtimeWorkers) {
    ctx.runtimeWorkers.stop();
  }
  if (ctx.marketCatalog) {
    await ctx.marketCatalog.stop();
  }
  if (ctx.webhook) {
    try { await ctx.webhook.stop(); } catch (err: any) {
      ctx.logger.warn({ mod: 'shutdown', err: err?.message }, 'webhook stop failed');
    }
  }
  await Promise.race([
    ctx.audit.stop(),
    new Promise((r) => setTimeout(r, grace)),
  ]);

  await closePool();
  ctx.logger.info({ mod: 'shutdown' }, 'shutdown complete');
}

export function installSignalHandlers(ctx: Context): void {
  let shutting = false;
  const handler = (sig: string): void => {
    if (shutting) return;
    shutting = true;
    void shutdown(ctx, sig).then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));

  process.on('unhandledRejection', (err) => {
    ctx.logger.fatal({ mod: 'process', err: String(err) }, 'unhandledRejection');
    ctx.audit.recordEvent({ kind: 'fatal', source: 'process', payload: { kind: 'unhandledRejection', err: String(err) } });
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    ctx.logger.fatal({ mod: 'process', err: err.message }, 'uncaughtException');
    ctx.audit.recordEvent({ kind: 'fatal', source: 'process', payload: { kind: 'uncaughtException', err: err.message } });
    process.exit(1);
  });
}
