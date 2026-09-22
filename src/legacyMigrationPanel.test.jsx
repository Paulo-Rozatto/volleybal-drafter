import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LegacyMigrationPreview from './LegacyMigrationPreview.jsx';
import LegacyPlayerMapping from './LegacyPlayerMapping.jsx';
import LegacyMigrationReport from './LegacyMigrationReport.jsx';
import LegacyMigrationView from './LegacyMigrationView.jsx';
import {
  canStartImport,
  formatMigrationProgress,
  itemsToImport,
  migrationSourceType,
} from './legacyMigrationPanel.js';

describe('legacy migration UI', () => {
  it('mostra o preview dry-run e a resolução de jogadores', () => {
    const plan = {
      summary: {
        playersFound: 18,
        playersNew: 14,
        playersNeedMapping: 3,
        playersMapped: 1,
        sessionsFound: 42,
        sessionsToImport: 38,
        sessionsImported: 4,
        sessionsConflicts: 0,
        competitionsFound: 6,
        competitionsToImport: 5,
        competitionsImported: 1,
        problems: 2,
      },
      players: [
        {
          legacyId: 'l1',
          name: 'André',
          status: 'NEEDS_PLAYER_MAPPING',
          collisions: [{ id: 'c1', name: 'André' }],
        },
      ],
    };

    const preview = renderToStaticMarkup(
      <LegacyMigrationPreview plan={plan} fingerprint="abc" sourceType="gist" />
    );
    expect(preview).toContain('18 encontrados');
    expect(preview).toContain('nenhuma escrita');
    expect(preview).toContain('Fingerprint');

    const mapping = renderToStaticMarkup(<LegacyPlayerMapping players={plan.players} />);
    expect(mapping).toContain('Legado: André');
    expect(mapping).toContain('Associar');
    expect(mapping).toContain('Criar novo player cloud');
    expect(mapping).toContain('Nome não é identidade');
  });

  it('relatório por item e progresso', () => {
    const report = renderToStaticMarkup(
      <LegacyMigrationReport
        results={[
          { ok: true, entityType: 'session', legacyId: 's1', name: 'Encontro 05/09' },
          {
            ok: false,
            entityType: 'session',
            legacyId: 's2',
            name: 'Encontro 19/09',
            errorCode: 'NEEDS_PLAYER_MAPPING',
          },
        ]}
      />
    );
    expect(report).toContain('Encontro 05/09');
    expect(report).toContain('PLAYER_MAPPING');
    expect(report).toContain('Tentar falhas novamente');
    expect(formatMigrationProgress(13, 42)).toBe('13 / 42');
  });

  it('exige auth na tela de migração e não começa import com mapping pendente', () => {
    const locked = renderToStaticMarkup(
      <LegacyMigrationView configured ready={false} user={null} onBack={() => {}} />
    );
    expect(locked).toContain('Voltar');
    expect(locked).toContain('Importar dados antigos');
    expect(canStartImport({ players: [{ status: 'NEEDS_PLAYER_MAPPING' }], sessions: [], competitions: [] })).toBe(
      false
    );
    expect(itemsToImport({ sessions: [{ status: 'NEW' }, { status: 'ALREADY_IMPORTED' }] }, 'sessions')).toHaveLength(
      1
    );
    expect(migrationSourceType(true)).toBe('gist');
    expect(migrationSourceType(false)).toBe('localStorage');
  });

  it('explica que o Gist não será apagado', () => {
    const html = renderToStaticMarkup(
      <LegacyMigrationView
        configured
        ready
        user={{ id: 'u1', email: 'a@b.c' }}
        players={[]}
        gameSessions={{ schemaVersion: 2, sessions: [] }}
        competitions={{ schemaVersion: 2, competitions: [] }}
        onBack={() => {}}
      />
    );
    expect(html).toContain('Nenhum dado antigo remoto será apagado');
    expect(html).toContain('Importar dados antigos');
    expect(html).toContain('Ler Gist antigo');
  });
});
