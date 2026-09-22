import { describe, expect, it } from 'vitest';
import {
  PLAYER_DECISIONS,
  buildLegacyMigrationPlan,
  canonicalJson,
  fingerprintLegacySnapshot,
  normalizeLegacyPlayers,
  normalizeLegacySessionsDocument,
} from './legacyMigration.js';

const ISO = '2026-09-12T18:00:00.000Z';

function player(id, name = 'André') {
  return { id, name, score: 3, gender: 'M', height: 'short' };
}

function draftSession(overrides = {}) {
  return {
    id: 'sess-1',
    date: '2026-09-12',
    name: 'Pelada',
    status: 'draft',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 2 },
    teams: [],
    rounds: [],
    ...overrides,
  };
}

describe('legacy migration planner', () => {
  it('não mescla jogadores só pelo nome e mantém dois Joãos distintos', () => {
    const plan = buildLegacyMigrationPlan({
      players: [player('j1', 'João'), player('j2', 'João')],
      sessionsDocument: { schemaVersion: 2, sessions: [] },
      competitionsDocument: { schemaVersion: 2, competitions: [] },
      cloudState: {
        mappablePlayers: [{ id: 'cloud-joao', name: 'João', created_by: 'u1' }],
      },
    });

    expect(plan.players).toHaveLength(2);
    expect(plan.players.map((item) => item.legacyId).sort()).toEqual(['j1', 'j2']);
    expect(plan.players.every((item) => item.status === 'NEEDS_PLAYER_MAPPING')).toBe(true);
    expect(plan.summary.playersNeedMapping).toBe(2);
  });

  it('mapping explícito reutiliza o player cloud; decisão criar novo libera a importação', () => {
    const mapped = buildLegacyMigrationPlan({
      players: [player('legacy-a', 'André')],
      sessionsDocument: { schemaVersion: 2, sessions: [] },
      competitionsDocument: { schemaVersion: 2, competitions: [] },
      cloudState: {
        playerMappings: [{ legacy_player_id: 'legacy-a', cloud_player_id: 'cloud-a' }],
        mappablePlayers: [{ id: 'cloud-a', name: 'André' }],
      },
    });
    expect(mapped.players[0].status).toBe('ALREADY_IMPORTED');
    expect(mapped.players[0].cloudId).toBe('cloud-a');

    const decided = buildLegacyMigrationPlan({
      players: [player('legacy-a', 'André')],
      sessionsDocument: { schemaVersion: 2, sessions: [] },
      competitionsDocument: { schemaVersion: 2, competitions: [] },
      cloudState: { mappablePlayers: [{ id: 'cloud-a', name: 'André' }] },
      playerDecisions: { 'legacy-a': { action: PLAYER_DECISIONS.CREATE_NEW } },
    });
    expect(decided.players[0].status).toBe('NEW');
  });

  it('marca sessão já importada e schema desconhecido', () => {
    const plan = buildLegacyMigrationPlan({
      players: [player('p1')],
      sessionsDocument: { schemaVersion: 2, sessions: [draftSession()] },
      competitionsDocument: { schemaVersion: 2, competitions: [] },
      cloudState: {
        sessions: [{ id: 'cloud-s', legacy_source_id: 'sess-1' }],
      },
    });
    expect(plan.sessions[0].status).toBe('ALREADY_IMPORTED');

    const unsupported = normalizeLegacySessionsDocument({ schemaVersion: 99, sessions: [] });
    expect(unsupported.ok).toBe(false);
    expect(unsupported.code).toBe('UNSUPPORTED_SCHEMA');
  });

  it('rejeita players.json que não é array e fingerprint é determinístico', async () => {
    expect(normalizeLegacyPlayers({}).ok).toBe(false);
    const left = await fingerprintLegacySnapshot({ a: 1, b: [2] });
    const right = await fingerprintLegacySnapshot({ b: [2], a: 1 });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
