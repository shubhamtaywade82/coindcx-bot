import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

export interface FuturesEndpointSpec {
  key: string;
  method: string;
  path: string;
  status: 'captured' | 'placeholder';
  source: 'authenticated_docs' | 'placeholder';
  notes?: string;
}

export interface FuturesEndpointCatalog {
  version: number;
  source: string;
  updated_at: string;
  endpoints: FuturesEndpointSpec[];
}

const FUTURES_ENDPOINTS_PATH = resolve(process.cwd(), 'config/coindcx_futures_endpoints.yml');
const PATH_PREFIX = '/exchange/v1/derivatives/futures/';

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid futures endpoint catalog: "${field}" must be a non-empty string`);
  }
}

function normalizeMethod(raw: string): string {
  return raw.toUpperCase();
}

function validateEndpoint(endpoint: unknown, idx: number): FuturesEndpointSpec {
  if (!endpoint || typeof endpoint !== 'object') {
    throw new Error(`Invalid futures endpoint catalog: endpoints[${idx}] must be an object`);
  }
  const row = endpoint as Record<string, unknown>;

  assertString(row.key, `endpoints[${idx}].key`);
  assertString(row.method, `endpoints[${idx}].method`);
  assertString(row.path, `endpoints[${idx}].path`);
  assertString(row.status, `endpoints[${idx}].status`);
  assertString(row.source, `endpoints[${idx}].source`);

  const method = normalizeMethod(row.method);
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error(`Invalid futures endpoint catalog: endpoints[${idx}].method "${row.method}" is not supported`);
  }

  const status = row.status as FuturesEndpointSpec['status'];
  if (status !== 'captured' && status !== 'placeholder') {
    throw new Error(`Invalid futures endpoint catalog: endpoints[${idx}].status "${row.status}" is invalid`);
  }

  const source = row.source as FuturesEndpointSpec['source'];
  if (source !== 'authenticated_docs' && source !== 'placeholder') {
    throw new Error(`Invalid futures endpoint catalog: endpoints[${idx}].source "${row.source}" is invalid`);
  }

  const path = row.path.trim();
  if (!path.startsWith(PATH_PREFIX)) {
    throw new Error(
      `Invalid futures endpoint catalog: endpoints[${idx}].path must start with "${PATH_PREFIX}"`,
    );
  }

  return {
    key: row.key.trim(),
    method,
    path,
    status,
    source,
    notes: typeof row.notes === 'string' ? row.notes : undefined,
  };
}

export function loadFuturesEndpointCatalogFromPath(path: string): FuturesEndpointCatalog {
  const raw = readFileSync(path, 'utf8');
  const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid futures endpoint catalog: root must be a YAML object');
  }

  const version = Number(parsed.version);
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error('Invalid futures endpoint catalog: "version" must be a positive integer');
  }

  assertString(parsed.source, 'source');
  assertString(parsed.updated_at, 'updated_at');

  const endpointsRaw = parsed.endpoints;
  if (!Array.isArray(endpointsRaw) || endpointsRaw.length === 0) {
    throw new Error('Invalid futures endpoint catalog: "endpoints" must be a non-empty array');
  }

  const endpoints = endpointsRaw.map((entry, idx) => validateEndpoint(entry, idx));
  const keys = new Set<string>();
  for (const endpoint of endpoints) {
    if (keys.has(endpoint.key)) {
      throw new Error(`Invalid futures endpoint catalog: duplicate endpoint key "${endpoint.key}"`);
    }
    keys.add(endpoint.key);
  }

  return {
    version,
    source: parsed.source,
    updated_at: parsed.updated_at,
    endpoints,
  };
}

export function loadFuturesEndpointCatalog(): FuturesEndpointCatalog {
  return loadFuturesEndpointCatalogFromPath(FUTURES_ENDPOINTS_PATH);
}
