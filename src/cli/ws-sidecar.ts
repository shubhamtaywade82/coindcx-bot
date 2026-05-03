import { CoinDCXWs } from '../gateways/coindcx-ws';
import { config } from '../config/config';
import { createLogger } from '../logging/logger';
import { RedisStreamPublisher } from '../sidecar/redis-stream-publisher';
import { WsSidecar } from '../sidecar/ws-sidecar';

async function main(): Promise<void> {
  const logger = await createLogger({
    logDir: config.LOG_DIR,
    level: config.LOG_LEVEL,
    rotateMb: config.LOG_FILE_ROTATE_MB,
    keep: config.LOG_FILE_KEEP,
    enableStdout: true,
  });

  const ws = new CoinDCXWs();
  const publisher = new RedisStreamPublisher({ redisUrl: config.REDIS_URL, streamPrefix: 'sidecar' });
  const sidecar = new WsSidecar({
    ws,
    publisher,
    logger: {
      info: (meta, msg) => logger.info(meta, msg),
      warn: (meta, msg) => logger.warn(meta, msg),
      error: (meta, msg) => logger.error(meta, msg),
    },
  });

  const shutdown = async (): Promise<void> => {
    ws.disconnect();
    await publisher.close();
    await logger.flush();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  sidecar.start();
  logger.info(
    { mod: 'ws-sidecar', pairs: ws.getSubscribedPairs(), redis: config.REDIS_URL },
    'ws sidecar started',
  );
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
