/** Programmatic access to api.ollama.com / ollama.com requires a Bearer API key. */
export function ollamaHostRequiresApiKey(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'ollama.com' || u.hostname.endsWith('.ollama.com');
  } catch {
    return false;
  }
}
