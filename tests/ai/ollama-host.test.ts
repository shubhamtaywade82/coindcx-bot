import { describe, it, expect } from 'vitest';
import { ollamaHostRequiresApiKey } from '../../src/ai/ollama-host';

describe('ollamaHostRequiresApiKey', () => {
  it('is true for ollama.com', () => {
    expect(ollamaHostRequiresApiKey('https://ollama.com')).toBe(true);
    expect(ollamaHostRequiresApiKey('https://ollama.com/')).toBe(true);
  });

  it('is false for localhost', () => {
    expect(ollamaHostRequiresApiKey('http://127.0.0.1:11434')).toBe(false);
  });
});
