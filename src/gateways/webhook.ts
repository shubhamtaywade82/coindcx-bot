import * as http from 'http';
import { parsePineAlert } from '../utils/alert-parser';
import type { SignalBus } from '../signals/bus';
import type { AppLogger } from '../logging/logger';
import type { Signal } from '../signals/types';
import { ulid } from 'ulid';

const MAX_BODY_BYTES = 64 * 1024;

export interface WebhookOptions {
  port: number;
  path: string;
  bus: SignalBus;
  logger: AppLogger;
  host?: string;
  sharedSecret?: string;
}

export class WebhookGateway {
  private server: http.Server;

  constructor(private readonly opts: WebhookOptions) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  start(): void {
    const host = this.opts.host ?? '127.0.0.1';
    this.server.listen(this.opts.port, host, () => {
      this.opts.logger.info(
        { mod: 'webhook', host, port: this.opts.port, path: this.opts.path, authRequired: !!this.opts.sharedSecret },
        'webhook gateway listening',
      );
    });
    this.server.on('error', (err) => {
      this.opts.logger.error({ mod: 'webhook', err: err.message }, 'webhook server error');
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.opts.logger.info({ mod: 'webhook' }, 'webhook gateway stopped');
  }

  private authOk(req: http.IncomingMessage): boolean {
    if (!this.opts.sharedSecret) return true;
    const header = req.headers['x-auth-token'];
    if (typeof header === 'string' && header === this.opts.sharedSecret) return true;
    const url = new URL(req.url ?? '/', 'http://x');
    return url.searchParams.get('token') === this.opts.sharedSecret;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (req.method !== 'POST' || urlPath !== this.opts.path) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (!this.authOk(req)) {
      this.opts.logger.warn({ mod: 'webhook', ip: req.socket.remoteAddress }, 'webhook auth rejected');
      res.statusCode = 401;
      res.end('unauthorized');
      return;
    }

    let size = 0;
    let body = '';
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.statusCode = 413;
        res.end('payload too large');
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const parsed = parsePineAlert(body);
        if (parsed) {
          const signal: Signal = {
            id: ulid(),
            ts: new Date().toISOString(),
            strategy: parsed.strategy || 'pine.unknown',
            type: parsed.type || 'alert',
            severity: parsed.severity || 'info',
            pair: parsed.pair,
            payload: parsed.payload || { raw: body },
          };
          await this.opts.bus.emit(signal);
          this.opts.logger.info(
            { mod: 'webhook', strategy: signal.strategy, type: signal.type, pair: signal.pair, severity: signal.severity },
            'pine signal emitted',
          );
        } else {
          this.opts.logger.debug({ mod: 'webhook', bytes: size }, 'webhook body unparsed');
        }
        res.statusCode = 200;
        res.end('OK');
      } catch (err: any) {
        this.opts.logger.error({ mod: 'webhook', err: err.message }, 'webhook processing failed');
        res.statusCode = 500;
        res.end('error');
      }
    });
    req.on('error', (err) => {
      this.opts.logger.warn({ mod: 'webhook', err: err.message }, 'webhook request error');
    });
  }
}
