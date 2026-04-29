import * as http from 'http';
import { parsePineAlert } from '../utils/alert-parser';
import type { SignalBus } from '../signals/bus';
import type { AppLogger } from '../logging/logger';
import type { Signal } from '../signals/types';
import { ulid } from 'ulid';

export interface WebhookOptions {
  port: number;
  path: string;
  bus: SignalBus;
  logger: AppLogger;
}

export class WebhookGateway {
  private server: http.Server;

  constructor(private readonly opts: WebhookOptions) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  start() {
    this.server.listen(this.opts.port, () => {
      this.opts.logger.info({ mod: 'webhook', port: this.opts.port, path: this.opts.path }, 'Webhook gateway listening');
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'POST' || req.url !== this.opts.path) {
      res.statusCode = 404;
      res.end();
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        this.opts.logger.debug({ mod: 'webhook', body }, 'Received webhook body');
        
        const parsed = parsePineAlert(body);
        if (parsed) {
          const signal: Signal = {
            id: ulid(),
            ts: new Date().toISOString(),
            strategy: parsed.strategy || 'pine.unknown',
            type: parsed.type || 'alert',
            severity: parsed.severity || 'info',
            pair: parsed.pair,
            payload: parsed.payload || { raw: body }
          };

          await this.opts.bus.emit(signal);
          this.opts.logger.info({ mod: 'webhook', strategy: signal.strategy, type: signal.type, pair: signal.pair }, 'Pine signal processed');
        }

        res.statusCode = 200;
        res.end('OK');
      } catch (err: any) {
        this.opts.logger.error({ mod: 'webhook', err: err.message }, 'Webhook processing failed');
        res.statusCode = 500;
        res.end('Error');
      }
    });
  }
}
