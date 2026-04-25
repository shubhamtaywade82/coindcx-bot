import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../src/logging/logger';

describe('logger', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'log-'));
  });

  it('writes JSON to file and redacts secrets', async () => {
    const log = await createLogger({ logDir: dir, level: 'info', rotateMb: 50, keep: 5 });
    log.info({ apiKey: 'shhh', user: 'alice' }, 'hello');
    log.flush?.();
    await new Promise((r) => setTimeout(r, 200));
    const files = readdirSync(dir).filter((f) => f.startsWith('bot'));
    expect(files.length).toBeGreaterThan(0);
    const content = readFileSync(join(dir, files[0]!), 'utf8');
    expect(content).toMatch(/"msg":"hello"/);
    expect(content).toMatch(/"apiKey":"\*\*\*"/);
    expect(content).not.toMatch(/shhh/);
  });

  it('child logger inherits redaction', async () => {
    const log = await createLogger({ logDir: dir, level: 'info', rotateMb: 50, keep: 5 });
    const child = log.child({ mod: 'ws' });
    child.info({ token: 'tk' }, 'evt');
    log.flush?.();
    await new Promise((r) => setTimeout(r, 200));
    const files = readdirSync(dir).filter((f) => f.startsWith('bot'));
    const content = readFileSync(join(dir, files[0]!), 'utf8');
    expect(content).toMatch(/"mod":"ws"/);
    expect(content).toMatch(/"token":"\*\*\*"/);
  });
});
