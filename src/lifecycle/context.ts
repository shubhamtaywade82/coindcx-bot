import type { Pool } from 'pg';
import type { Config } from '../config/schema';
import type { AppLogger } from '../logging/logger';
import type { Audit } from '../audit/audit';
import type { SignalBus } from '../signals/bus';
import type { Cursors } from '../resume/cursors';
import type { AiAnalyzer } from '../ai/analyzer';

export interface Context {
  config: Config;
  logger: AppLogger;
  pool: Pool;
  audit: Audit;
  bus: SignalBus;
  cursors: Cursors;
  analyzer: AiAnalyzer;
}
