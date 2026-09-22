import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = dirname(fileURLToPath(import.meta.url));

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'migration' || entry === 'persistence') continue;
      walk(full, acc);
    } else if (/\.(js|jsx)$/.test(entry) && !entry.endsWith('.test.js') && !entry.endsWith('.test.jsx')) {
      acc.push(full);
    }
  }
  return acc;
}

function read(name) {
  return readFileSync(join(srcRoot, name), 'utf8');
}

describe('etapa 8: boundary cloud vs legado', () => {
  const operational = [
    'App.jsx',
    'CloudSessionsView.jsx',
    'CloudSessionDetail.jsx',
    'CloudSessionCreateForm.jsx',
    'CloudCompetitionsView.jsx',
    'CloudCompetitionDetail.jsx',
    'CloudCompetitionCreateForm.jsx',
    'CloudGroupsView.jsx',
    'CloudGroupDetail.jsx',
    'CloudGroupRanking.jsx',
    'CloudProfileView.jsx',
    'AuthPanel.jsx',
    'JoinSessionView.jsx',
    'JoinGroupView.jsx',
    'JoinCompetitionView.jsx',
  ];

  it('fluxo normal não importa Gist adapter nem storage legado', () => {
    for (const file of operational) {
      const source = read(file);
      expect(source, file).not.toMatch(/gistService/);
      expect(source, file).not.toMatch(/GistSyncPanel/);
      expect(source, file).not.toMatch(/saveGistState/);
      expect(source, file).not.toMatch(/loadGistState/);
      expect(source, file).not.toMatch(/persistLocalGameSessions/);
      expect(source, file).not.toMatch(/persistLocalCompetitions/);
      expect(source, file).not.toMatch(/markPendingGistChanges/);
      expect(source, file).not.toMatch(/volleyGameSessions/);
      expect(source, file).not.toMatch(/volleyCompetitions/);
      expect(source, file).not.toMatch(/volleyPlayers/);
      expect(source, file).not.toMatch(/volleyGistPendingChanges/);
      expect(source, file).not.toMatch(/ENCRYPTED_GITHUB_TOKEN/);
    }
  });

  it('App não monta telas Gist nem dual-write', () => {
    const app = read('App.jsx');
    expect(app).not.toMatch(/GameSessionsView/);
    expect(app).not.toMatch(/<CompetitionsView/);
    expect(app).not.toMatch(/from ['"].\/CompetitionsView/);
    expect(app).not.toMatch(/GistSyncPanel/);
    expect(app).not.toMatch(/Salvar no Gist/);
    expect(app).toMatch('<CloudSessionsView');
    expect(app).toMatch('<CloudCompetitionsView');
    expect(app).toMatch('🗓️ Encontros');
    expect(app).toMatch('🏆 Competições');
    expect(app).not.toMatch(/Encontros online/);
    expect(app).not.toMatch(/\bGist\b/);
  });

  it('menu normal não mostra Gist; migration reader fica isolado', () => {
    const app = read('App.jsx');
    expect(app).toMatch('Importar dados antigos');
    expect(app).toMatch('#/migration');
    const migrationView = read('LegacyMigrationView.jsx');
    expect(migrationView).toMatch("from './migration/legacy/gistReader.js'");
    expect(migrationView).toMatch("from './migration/legacy/localLegacyReader.js'");
    const cloudFiles = walk(srcRoot).filter((file) => /Cloud|Join|AuthPanel|App\.jsx/.test(file));
    for (const file of cloudFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/migration\/legacy\/gistReader/);
      expect(source, file).not.toMatch(/api\.github\.com\/gists/);
    }
  });

  it('criação cloud não escreve chaves de domínio legado', () => {
    expect(read('CloudSessionCreateForm.jsx')).toMatch(/createCloudSession/);
    expect(read('CloudSessionCreateForm.jsx')).not.toMatch(/localStorage/);
    expect(read('CloudCompetitionCreateForm.jsx')).toMatch(/createCloudCompetition/);
    expect(read('CloudCompetitionCreateForm.jsx')).not.toMatch(/localStorage/);
    expect(read('CloudSessionDetail.jsx')).toMatch(/setCloudMatchScore/);
    expect(read('CloudSessionDetail.jsx')).not.toMatch(/volleyGistPendingChanges/);
    expect(read('CloudCompetitionDetail.jsx')).toMatch(/setCloudCompetitionMatchScore/);
    expect(read('CloudCompetitionDetail.jsx')).not.toMatch(/volleyGistPendingChanges/);
  });
});
