import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAnalyzer } from '../../src/ai/analyzer';
import type { Config } from '../../src/config/schema';

interface ChatCall { host: string; model: string }
interface ChatBehavior { ok?: any; err?: any }

const stubLogger = {
  child: () => stubLogger,
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
} as any;

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    OLLAMA_URL: 'https://ollama.com',
    OLLAMA_MODEL: 'gpt-oss:120b-cloud',
    OLLAMA_API_KEY: 'cloud-key',
    OLLAMA_MAX_CONCURRENCY: 1,
    OLLAMA_MIN_INTERVAL_MS: 0,
    OLLAMA_RETRY_MAX: 0,
    OLLAMA_RETRY_BASE_MS: 100,
    OLLAMA_FALLBACK_URL: 'http://127.0.0.1:11434',
    OLLAMA_FALLBACK_MODEL: 'llama3',
    ...overrides,
  } as unknown as Config;
}

const sampleState = { symbol: 'B-SOL_USDT', current_price: 100 };

function makeOllamaCtor(
  chatCalls: ChatCall[],
  behaviors: Map<string, ChatBehavior>,
): any {
  return class FakeOllama {
    private readonly host: string;
    constructor(opts: { host: string }) { this.host = opts.host; }
    async chat(args: { model: string }): Promise<any> {
      chatCalls.push({ host: this.host, model: args.model });
      const behavior = behaviors.get(this.host);
      if (!behavior) throw new Error(`no behavior set for host ${this.host}`);
      if (behavior.err) throw behavior.err;
      return { message: { content: JSON.stringify(behavior.ok) } };
    }
  };
}

let chatCalls: ChatCall[];
let behaviors: Map<string, ChatBehavior>;
let ollamaCtor: any;

beforeEach(() => {
  chatCalls = [];
  behaviors = new Map();
  ollamaCtor = makeOllamaCtor(chatCalls, behaviors);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AiAnalyzer cloud → local fallback', () => {
  it('falls back to local Ollama when cloud throws a network error', async () => {
    behaviors.set('https://ollama.com', { err: new Error('fetch failed') });
    behaviors.set('http://127.0.0.1:11434', {
      ok: { signal: 'WAIT', confidence: 0, verdict: 'local result' },
    });

    const analyzer = new AiAnalyzer(buildConfig(), stubLogger, { ollamaCtor });
    const result = await analyzer.analyze(sampleState);

    expect(result.verdict).toBe('local result');
    expect(chatCalls.map(c => c.host)).toEqual([
      'https://ollama.com',
      'http://127.0.0.1:11434',
    ]);
  });

  it('falls back when cloud rejects with HTTP 401 (auth)', async () => {
    const authErr: any = new Error('Unauthorized');
    authErr.status_code = 401;
    behaviors.set('https://ollama.com', { err: authErr });
    behaviors.set('http://127.0.0.1:11434', {
      ok: { signal: 'LONG', confidence: 0.7, verdict: 'local long' },
    });

    const analyzer = new AiAnalyzer(buildConfig(), stubLogger, { ollamaCtor });
    const result = await analyzer.analyze(sampleState);

    expect(result.verdict).toBe('local long');
    expect(chatCalls).toHaveLength(2);
  });

  it('does not fall back on 429 rate-limit errors', async () => {
    const rateErr: any = new Error('too many concurrent requests');
    rateErr.status_code = 429;
    behaviors.set('https://ollama.com', { err: rateErr });
    behaviors.set('http://127.0.0.1:11434', {
      ok: { signal: 'LONG', confidence: 0.9, verdict: 'should not be used' },
    });

    const analyzer = new AiAnalyzer(buildConfig(), stubLogger, { ollamaCtor });
    const result = await analyzer.analyze(sampleState);

    expect(result.signal).toBe('WAIT');
    expect(chatCalls.map(c => c.host)).toEqual(['https://ollama.com']);
  });

  it('returns the WAIT error when primary fails and no fallback is configured', async () => {
    behaviors.set('https://ollama.com', { err: new Error('fetch failed') });

    const analyzer = new AiAnalyzer(
      buildConfig({ OLLAMA_FALLBACK_URL: '' } as any),
      stubLogger,
      { ollamaCtor },
    );
    const result = await analyzer.analyze(sampleState);

    expect(result.signal).toBe('WAIT');
    expect(chatCalls.map(c => c.host)).toEqual(['https://ollama.com']);
  });

  it('uses fallback directly when cloud key is missing but fallback is configured', async () => {
    behaviors.set('http://127.0.0.1:11434', {
      ok: { signal: 'WAIT', confidence: 0.4, verdict: 'local key-less' },
    });

    const analyzer = new AiAnalyzer(
      buildConfig({ OLLAMA_API_KEY: '' } as any),
      stubLogger,
      { ollamaCtor },
    );
    const result = await analyzer.analyze(sampleState);

    expect(result.verdict).toBe('local key-less');
    expect(chatCalls.map(c => c.host)).toEqual(['http://127.0.0.1:11434']);
  });
});
