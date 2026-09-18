import { describe, expect, it } from 'vitest';
import { COMPETITION_SCHEMA_VERSION } from '../domain/competition.js';
import { migrateCompetitionsDocumentToV2 } from './competitionsMigration.js';
import { interpretCompetitionsJson } from './competitionsDocument.js';

const ISO = '2026-09-18T18:00:00.000Z';

describe('migração de competitions.json v1 → v2', () => {
  it('envolve rounds e tournamentType em uma fase de eliminação simples', () => {
    const migrated = migrateCompetitionsDocumentToV2({
      schemaVersion: 1,
      competitions: [
        {
          id: 'c1',
          name: 'Open',
          status: 'draft',
          createdAt: ISO,
          updatedAt: ISO,
          format: { teamSize: 2 },
          tournamentType: 'single_elimination',
          seedTeamIds: [],
          teams: [],
          rounds: [],
        },
      ],
    });

    expect(migrated.ok).toBe(true);
    expect(migrated.migrated).toBe(true);
    expect(migrated.document.schemaVersion).toBe(COMPETITION_SCHEMA_VERSION);
    expect(migrated.document.competitions[0].stages).toEqual([
      {
        id: 'c1-stage-1',
        number: 1,
        name: 'Eliminação simples',
        type: 'single_elimination',
        status: 'pending',
        config: {},
        seedTeamIds: [],
        seedSnapshot: null,
        rounds: [],
      },
    ]);
    expect(migrated.document.competitions[0].tournamentType).toBeUndefined();
    expect(migrated.document.competitions[0].rounds).toBeUndefined();
  });

  it('marca interpretCompetitionsJson como migrado e valida o documento', () => {
    const interpreted = interpretCompetitionsJson(
      JSON.stringify({
        schemaVersion: 1,
        competitions: [
          {
            id: 'c2',
            name: 'Aberto',
            status: 'draft',
            createdAt: ISO,
            updatedAt: ISO,
            format: { teamSize: 2 },
            tournamentType: 'single_elimination',
            teams: [],
            rounds: [],
          },
        ],
      })
    );
    expect(interpreted.migrated).toBe(true);
    expect(interpreted.sourceVersion).toBe(1);
    expect(interpreted.document.schemaVersion).toBe(2);
    expect(interpreted.document.competitions[0].stages[0].type).toBe('single_elimination');
  });
});
