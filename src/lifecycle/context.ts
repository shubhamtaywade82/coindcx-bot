import type { Pool } from 'pg';
import type { Config } from '../config/schema';
import type { AppLogger } from '../logging/logger';
import type { Audit } from '../audit/audit';
import type { SignalBus } from '../signals/bus';
import type { Cursors } from '../resume/cursors';
import type { AiAnalyzer } from '../ai/analyzer';
import type { MarketStateBuilder } from '../ai/state-builder';
import type { WebhookGateway } from '../gateways/webhook';
import type { MarketCatalog } from '../marketdata/market-catalog';
import type { CoreRuntimePipeline } from '../runtime/runtime-pipeline';
import type { RuntimeWorkerSet } from '../runtime/workers/runtime-workers';
import type { PredictionOutcomeRepository } from '../prediction-outcomes/repository';

export interface Context {
  config: Config;
  logger: AppLogger;
  pool: Pool;
  audit: Audit;
  bus: SignalBus;
  cursors: Cursors;
  analyzer: AiAnalyzer;
  stateBuilder: MarketStateBuilder;
  marketCatalog: MarketCatalog;
  runtime: CoreRuntimePipeline;
  runtimeWorkers?: RuntimeWorkerSet;
  webhook?: WebhookGateway;
  predictionOutcomeRepo: PredictionOutcomeRepository;
  /** Cleared on shutdown when prediction outcome resolver interval is used. */
  predictionOutcomeResolverTimer?: ReturnType<typeof setInterval>;
}
