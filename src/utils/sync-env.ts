import * as fs from 'fs';
import * as path from 'path';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const EXAMPLE_PATH = path.resolve(process.cwd(), '.env.example');

export function syncEnv() {
  if (!fs.existsSync(EXAMPLE_PATH)) {
    console.error('.env.example does not exist.');
    return;
  }

  const exampleLines = fs.readFileSync(EXAMPLE_PATH, 'utf-8').split('\n');
  let currentEnvContent = '';
  
  if (fs.existsSync(ENV_PATH)) {
    currentEnvContent = fs.readFileSync(ENV_PATH, 'utf-8');
  } else {
    fs.writeFileSync(ENV_PATH, '');
  }

  const currentLines = currentEnvContent.split('\n');
  const currentKeys = new Set(
    currentLines
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => line.split('=')[0]?.trim())
  );

  const linesToAdd: string[] = [];
  let currentCommentGroup: string[] = [];

  for (const line of exampleLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      currentCommentGroup = [];
      continue;
    }

    if (trimmed.startsWith('#')) {
      currentCommentGroup.push(line);
      continue;
    }

    const key = trimmed.split('=')[0]?.trim();
    if (key && !currentKeys.has(key)) {
      if (currentCommentGroup.length > 0) {
        linesToAdd.push(...currentCommentGroup);
      }
      linesToAdd.push(line);
      currentKeys.add(key);
    }
    currentCommentGroup = [];
  }

  if (linesToAdd.length > 0) {
    const appendContent = (currentEnvContent.endsWith('\n') ? '' : '\n') + linesToAdd.join('\n') + '\n';
    fs.appendFileSync(ENV_PATH, appendContent);
    console.log(`Updated .env with new variables from .env.example: ${linesToAdd.filter(l => !l.startsWith('#')).map(l => l.split('=')[0]).join(', ')}`);
  }
}

if (require.main === module) {
  syncEnv();
}
