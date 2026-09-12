import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = dirname(fileURLToPath(import.meta.url));
const IMPORT_PATTERN = /from ['"].*gameSessions\.js['"]/;

function listSourceFiles(directory) {
  const entries = readdirSync(directory);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (!fullPath.endsWith('.js') && !fullPath.endsWith('.jsx')) continue;
    if (fullPath.includes('.test.')) continue;
    if (fullPath.endsWith(`${join('src', 'gameSessions.js')}`) || entry === 'gameSessions.js') continue;
    files.push(fullPath);
  }
  return files;
}

describe('ausência de import produtivo do módulo V1', () => {
  it('código de produção não importa gameSessions.js', () => {
    const offenders = listSourceFiles(srcRoot).filter((file) =>
      IMPORT_PATTERN.test(readFileSync(file, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
