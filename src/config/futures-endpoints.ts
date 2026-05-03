import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

export type EndpointCaptureStatus = 'pending' | 'captured';
export type EndpointMethod = 'UNKNOWN' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FuturesSourceSection {
  docsHost: string;
  requiresAuthenticatedCapture: boolean;
  captureStatus: EndpointCaptureStatus;
  capturedAt: string | null;
  capturedBy: string | null;
  notes?: string;
}

export interface FuturesEndpointEntry {
  key: string;
  label: string;
  method: EndpointMethod;
  path: string;
  paramsSpec: string;
  status: EndpointCaptureStatus;
}

export interface FuturesEndpointSpec {
  catalogVersion: number;
  source: FuturesSourceSection;
  endpoints: FuturesEndpointEntry[];
}

const SPEC_PATH = resolve(process.cwd(), 'config/coindcx_futures_endpoints.yml');
const PATH_PREFIX = '/exchange/v1/derivatives/futures/';
const VALID_METHODS: readonly EndpointMethod[] = ['UNKNOWN', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid futures endpoint spec: "${field}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid futures endpoint spec: "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid futures endpoint spec: "${field}" must be a boolean`);
  }
  return value;
}

function asStatus(value: unknown, field: string): EndpointCaptureStatus {
  const status = asString(value, field);
  if (status === 'placeholder') return 'pending';
  if (status !== 'pending' && status !== 'captured') {
    throw new Error(`Invalid futures endpoint spec: "${field}" must be "pending" or "captured"`);
  }
  return status;
}

function asMethod(value: unknown, field: string): EndpointMethod {
  const method = asString(value, field).toUpperCase() as EndpointMethod;
  if (!VALID_METHODS.includes(method)) {
    throw new Error(`Invalid futures endpoint spec: "${field}" "${method}" is not supported`);
  }
  return method;
}

function asNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, field);
}

function labelFromKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function parseEndpoint(entry: unknown, idx: number): FuturesEndpointEntry {
  const row = asObject(entry, `endpoints[${idx}]`);
  const method = asMethod(row.method, `endpoints[${idx}].method`);
  const path = asString(row.path, `endpoints[${idx}].path`);
  if (method !== 'UNKNOWN' && !path.startsWith(PATH_PREFIX)) {
    throw new Error(
      `Invalid futures endpoint spec: endpoints[${idx}].path must start with "${PATH_PREFIX}" when method is concrete`,
    );
  }
  if (method === 'UNKNOWN' && path !== 'TBD') {
    throw new Error('Invalid futures endpoint spec: UNKNOWN method endpoints must keep path as "TBD"');
  }
  return {
    key: asString(row.key, `endpoints[${idx}].key`),
    label:
      typeof row.label === 'string' && row.label.trim().length > 0
        ? row.label.trim()
        : labelFromKey(asString(row.key, `endpoints[${idx}].key`)),
    method,
    path,
    paramsSpec:
      typeof row.paramsSpec === 'string' && row.paramsSpec.trim().length > 0
        ? row.paramsSpec.trim()
        : 'TBD',
    status: asStatus(row.status, `endpoints[${idx}].status`),
  };
}

export function loadFuturesEndpointSpec(specPath: string = SPEC_PATH): FuturesEndpointSpec {
  const raw = readFileSync(specPath, 'utf8');
  const parsed = yaml.load(raw);
  const root = asObject(parsed, 'root');

  const catalogVersion = Number(root.catalogVersion ?? root.version);
  if (!Number.isInteger(catalogVersion) || catalogVersion <= 0) {
    throw new Error('Invalid futures endpoint spec: "catalogVersion" (or "version") must be a positive integer');
  }

  const source: FuturesSourceSection = (() => {
    if (typeof root.source === 'string') {
      return {
        docsHost: 'docs.coindcx.com',
        requiresAuthenticatedCapture: true,
        captureStatus: root.source.includes('captured') ? 'captured' : 'pending',
        capturedAt: asNullableString(root.updated_at, 'updated_at'),
        capturedBy: null,
        notes: root.source,
      };
    }

    const sourceRaw = asObject(root.source, 'source');
    return {
      docsHost: asString(sourceRaw.docsHost, 'source.docsHost'),
      requiresAuthenticatedCapture: asBoolean(
        sourceRaw.requiresAuthenticatedCapture,
        'source.requiresAuthenticatedCapture',
      ),
      captureStatus: asStatus(sourceRaw.captureStatus, 'source.captureStatus'),
      capturedAt: asNullableString(sourceRaw.capturedAt, 'source.capturedAt'),
      capturedBy: asNullableString(sourceRaw.capturedBy, 'source.capturedBy'),
      notes: typeof sourceRaw.notes === 'string' ? sourceRaw.notes.trim() : undefined,
    };
  })();

  const endpointsRaw = root.endpoints;
  if (!Array.isArray(endpointsRaw) || endpointsRaw.length === 0) {
    throw new Error('Invalid futures endpoint spec: "endpoints" must be a non-empty array');
  }

  const endpoints = endpointsRaw.map((entry, idx) => parseEndpoint(entry, idx));
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.key)) {
      throw new Error(`Invalid futures endpoint spec: duplicate endpoint key "${endpoint.key}"`);
    }
    seen.add(endpoint.key);
  }

  return { catalogVersion, source, endpoints };
}

export function validateFuturesEndpointSpec(spec: FuturesEndpointSpec): string[] {
  const issues: string[] = [];

  if (spec.source.captureStatus === 'captured' && !spec.source.capturedAt) {
    issues.push('source.capturedAt is required when captureStatus=captured');
  }
  if (spec.source.captureStatus === 'captured' && !spec.source.capturedBy) {
    issues.push('source.capturedBy is required when captureStatus=captured');
  }

  for (const endpoint of spec.endpoints) {
    if (endpoint.status === 'captured') {
      if (endpoint.method === 'UNKNOWN') {
        issues.push(`endpoint "${endpoint.key}" is captured but method remains UNKNOWN`);
      }
      if (endpoint.path === 'TBD') {
        issues.push(`endpoint "${endpoint.key}" is captured but path is still TBD`);
      }
      if (endpoint.paramsSpec === 'TBD') {
        issues.push(`endpoint "${endpoint.key}" is captured but paramsSpec is still TBD`);
      }
    }
  }

  return issues;
}

// Backward-compatible aliases used by tests/CLI.
export function loadFuturesEndpointCatalogFromPath(specPath: string): FuturesEndpointSpec {
  return loadFuturesEndpointSpec(specPath);
}

export function loadFuturesEndpointCatalog(): FuturesEndpointSpec {
  return loadFuturesEndpointSpec();
}

export function readFuturesEndpointCatalog(): FuturesEndpointSpec {
  return loadFuturesEndpointSpec();
}

export function validateFuturesEndpointCatalog(spec: FuturesEndpointSpec): string[] {
  return validateFuturesEndpointSpec(spec);
}
