import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_SCHEMA_VERSION } from './constants.js';
import { TEAM_SESSION_SCHEMA_VERSION } from '../domain/teamSession.js';
import { migrateGameSessionsDocumentToV2 } from './gameSessionsMigration.js';

const ISO_CREATED = '2026-09-12T18:00:00.000Z';
const ISO_UPDATED = '2026-09-12T19:00:00.000Z';

function pair(id, a, b, names) {
  return {
    id,
    members: [
      { playerId: a, playerName: names[0] },
      { playerId: b, playerName: names[1] },
    ],
  };
}

function v1Session(overrides = {}) {
  return {
    id: 'session-1',
    date: '2026-09-12',
    name: 'Arena',
    status: 'draft',
    createdAt: ISO_CREATED,
    updatedAt: ISO_UPDATED,
    pairs: [],
    rounds: [],
    ...overrides,
  };
}

function v1Document(sessions) {
  return {
    schemaVersion: 1,
    sessions,
  };
}

describe('compatibilidade da versão ativa', () => {
  it('mantém o schema ativo do App em 2', () => {
    expect(GAME_SESSIONS_SCHEMA_VERSION).toBe(2);
    expect(TEAM_SESSION_SCHEMA_VERSION).toBe(2);
  });
});

describe('migrateGameSessionsDocumentToV2', () => {
  it('migra sessão draft sem duplas', () => {
    const original = v1Document([v1Session()]);
    const snapshot = JSON.parse(JSON.stringify(original));
    const result = migrateGameSessionsDocumentToV2(original);

    expect(result.ok).toBe(true);
    expect(result.document.schemaVersion).toBe(2);
    expect(result.document.sessions[0]).toMatchObject({
      id: 'session-1',
      date: '2026-09-12',
      name: 'Arena',
      status: 'draft',
      createdAt: ISO_CREATED,
      updatedAt: ISO_UPDATED,
      format: { teamSize: 2, teamCount: 2 },
      teams: [],
      rounds: [],
    });
    expect(result.document.sessions[0]).not.toHaveProperty('pairs');
    expect(original).toEqual(snapshot);
  });

  it('migra duas, três e quatro duplas preservando IDs e membros', () => {
    const two = migrateGameSessionsDocumentToV2(
      v1Document([
        v1Session({
          pairs: [pair('pair-1', 'p1', 'p2', ['Erik', 'André']), pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza'])],
        }),
      ])
    );
    expect(two.document.sessions[0].format).toEqual({ teamSize: 2, teamCount: 2 });
    expect(two.document.sessions[0].teams.map((team) => team.id)).toEqual(['pair-1', 'pair-2']);
    expect(two.document.sessions[0].teams[0].members).toEqual([
      { playerId: 'p1', playerName: 'Erik' },
      { playerId: 'p2', playerName: 'André' },
    ]);

    const three = migrateGameSessionsDocumentToV2(
      v1Document([
        v1Session({
          pairs: [
            pair('pair-1', 'p1', 'p2', ['Erik', 'André']),
            pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza']),
            pair('pair-3', 'p5', 'p6', ['Ian', 'Ana']),
          ],
        }),
      ])
    );
    expect(three.document.sessions[0].format.teamCount).toBe(3);
    expect(three.document.sessions[0].teams).toHaveLength(3);

    const four = migrateGameSessionsDocumentToV2(
      v1Document([
        v1Session({
          pairs: [
            pair('pair-1', 'p1', 'p2', ['Erik', 'André']),
            pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza']),
            pair('pair-3', 'p5', 'p6', ['Ian', 'Ana']),
            pair('pair-4', 'p7', 'p8', ['BH', 'Arthur']),
          ],
        }),
      ])
    );
    expect(four.document.sessions[0].format.teamCount).toBe(4);
    expect(four.document.sessions[0].teams).toHaveLength(4);
    expect(four.document.sessions[0]).not.toHaveProperty('pairs');
  });

  it('migra rodada com folga, placares, status e timestamps e remove campos V1', () => {
    const original = v1Document([
      v1Session({
        status: 'in_progress',
        pairs: [
          pair('pair-1', 'p1', 'p2', ['Erik', 'André']),
          pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza']),
          pair('pair-3', 'p5', 'p6', ['Ian', 'Ana']),
        ],
        rounds: [
          {
            id: 'round-1',
            number: 1,
            byePairId: 'pair-3',
            matches: [
              {
                id: 'match-1',
                pairAId: 'pair-1',
                pairBId: 'pair-2',
                scoreA: 21,
                scoreB: 18,
              },
            ],
          },
        ],
      }),
    ]);

    const result = migrateGameSessionsDocumentToV2(original);
    const session = result.document.sessions[0];
    const match = session.rounds[0].matches[0];

    expect(result.ok).toBe(true);
    expect(session.status).toBe('in_progress');
    expect(session.createdAt).toBe(ISO_CREATED);
    expect(session.updatedAt).toBe(ISO_UPDATED);
    expect(session.rounds[0]).toMatchObject({
      id: 'round-1',
      number: 1,
      byeTeamId: 'pair-3',
    });
    expect(session.rounds[0]).not.toHaveProperty('byePairId');
    expect(match).toMatchObject({
      id: 'match-1',
      teamAId: 'pair-1',
      teamBId: 'pair-2',
      scoreA: 21,
      scoreB: 18,
    });
    expect(match).not.toHaveProperty('pairAId');
    expect(match).not.toHaveProperty('pairBId');
    expect(match.lineupA).toEqual([
      { playerId: 'p1', playerName: 'Erik' },
      { playerId: 'p2', playerName: 'André' },
    ]);
    expect(match.lineupB).toEqual([
      { playerId: 'p3', playerName: 'Gabi' },
      { playerId: 'p4', playerName: 'Luiza' },
    ]);
    expect(match.lineupA).not.toBe(original.sessions[0].pairs[0].members);
    expect(match.lineupA[0]).not.toBe(original.sessions[0].pairs[0].members[0]);
  });

  it('rejeita referência inexistente', () => {
    const result = migrateGameSessionsDocumentToV2(
      v1Document([
        v1Session({
          status: 'in_progress',
          pairs: [pair('pair-1', 'p1', 'p2', ['Erik', 'André']), pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza'])],
          rounds: [
            {
              id: 'round-1',
              number: 1,
              byePairId: null,
              matches: [{ id: 'match-1', pairAId: 'pair-1', pairBId: 'missing', scoreA: null, scoreB: null }],
            },
          ],
        }),
      ])
    );

    expect(result.ok).toBe(false);
    expect(result.document).toBeNull();
    expect(result.errors[0].code).toBe('MIGRATION_PAIR_NOT_FOUND');
  });

  it('rejeita byePairId inexistente', () => {
    const result = migrateGameSessionsDocumentToV2(
      v1Document([
        v1Session({
          pairs: [pair('pair-1', 'p1', 'p2', ['Erik', 'André']), pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza'])],
          rounds: [
            {
              id: 'round-1',
              number: 1,
              byePairId: 'ghost',
              matches: [{ id: 'match-1', pairAId: 'pair-1', pairBId: 'pair-2', scoreA: null, scoreB: null }],
            },
          ],
        }),
      ])
    );
    expect(result.errors[0].code).toBe('MIGRATION_PAIR_NOT_FOUND');
  });

  it('aceita documento V2 de forma idempotente e sem compartilhar estruturas', () => {
    const migrated = migrateGameSessionsDocumentToV2(
      v1Document([
        v1Session({
          pairs: [pair('pair-1', 'p1', 'p2', ['Erik', 'André']), pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza'])],
        }),
      ])
    );
    const again = migrateGameSessionsDocumentToV2(migrated.document);

    expect(again.ok).toBe(true);
    expect(again.document).toEqual(migrated.document);
    expect(again.document).not.toBe(migrated.document);
    expect(again.document.sessions).not.toBe(migrated.document.sessions);
    expect(again.document.sessions[0].teams).not.toBe(migrated.document.sessions[0].teams);
    expect(again.document.sessions[0].teams[0].members).not.toBe(migrated.document.sessions[0].teams[0].members);
    expect(again.document.sessions[0]).not.toHaveProperty('pairs');
  });

  it('não muta a entrada V1 nem a V2', () => {
    const v1 = v1Document([
      v1Session({
        pairs: [pair('pair-1', 'p1', 'p2', ['Erik', 'André']), pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza'])],
      }),
    ]);
    const v1Snapshot = JSON.parse(JSON.stringify(v1));
    const first = migrateGameSessionsDocumentToV2(v1);
    expect(v1).toEqual(v1Snapshot);

    const v2Snapshot = JSON.parse(JSON.stringify(first.document));
    first.document.sessions[0].teams[0].members[0].playerName = 'X';
    const second = migrateGameSessionsDocumentToV2(v2Snapshot);
    expect(second.document.sessions[0].teams[0].members[0].playerName).toBe('Erik');
    expect(v2Snapshot.sessions[0].teams[0].members[0].playerName).toBe('Erik');
  });

  it('rejeita documento nulo, sessions inválidas e versão desconhecida sem fallback vazio', () => {
    expect(migrateGameSessionsDocumentToV2(null).errors[0].code).toBe('DOCUMENT_REQUIRED');
    expect(migrateGameSessionsDocumentToV2(undefined).errors[0].code).toBe('DOCUMENT_REQUIRED');
    expect(migrateGameSessionsDocumentToV2({ schemaVersion: 1 }).errors[0].code).toBe('SESSIONS_NOT_ARRAY');
    expect(migrateGameSessionsDocumentToV2({ schemaVersion: 1, sessions: null }).errors[0].code).toBe(
      'SESSIONS_NOT_ARRAY'
    );
    expect(migrateGameSessionsDocumentToV2({ sessions: [] }).errors[0].code).toBe('SCHEMA_VERSION_REQUIRED');
    expect(migrateGameSessionsDocumentToV2({ schemaVersion: 3, sessions: [] }).errors[0].code).toBe(
      'SCHEMA_VERSION_UNSUPPORTED'
    );
    expect(migrateGameSessionsDocumentToV2({ schemaVersion: 3, sessions: [] }).document).toBeNull();
  });
});
