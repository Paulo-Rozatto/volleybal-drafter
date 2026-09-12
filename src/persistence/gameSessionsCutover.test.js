import { describe, expect, it } from 'vitest';
import { countSessionMatches } from '../domain/sessionValidation.js';
import { interpretGameSessionsJson } from './gameSessionsDocument.js';
import { resolveByeLabel, resolveTeamLabel } from '../roundDisplay.js';
import { teamSessionRoundSummary } from '../teamGameSessions.js';

function pair(id, a, b, names) {
  return {
    id,
    members: [
      { playerId: a, playerName: names[0] },
      { playerId: b, playerName: names[1] },
    ],
  };
}

function v1FourDoublesFixture() {
  return {
    schemaVersion: 1,
    sessions: [
      {
        id: 'session-arena',
        date: '2026-09-12',
        name: 'Sábado na Arena',
        status: 'in_progress',
        createdAt: '2026-09-12T18:00:00.000Z',
        updatedAt: '2026-09-12T19:30:00.000Z',
        pairs: [
          pair('pair-1', 'p1', 'p2', ['Erik', 'André']),
          pair('pair-2', 'p3', 'p4', ['Gabi', 'Luiza']),
          pair('pair-3', 'p5', 'p6', ['Ian', 'Ana']),
          pair('pair-4', 'p7', 'p8', ['BH', 'Arthur']),
        ],
        rounds: [
          {
            id: 'round-1',
            number: 1,
            byePairId: null,
            matches: [
              { id: 'match-1', pairAId: 'pair-1', pairBId: 'pair-4', scoreA: 21, scoreB: 18 },
              { id: 'match-2', pairAId: 'pair-2', pairBId: 'pair-3', scoreA: null, scoreB: null },
            ],
          },
          {
            id: 'round-2',
            number: 2,
            byePairId: null,
            matches: [
              { id: 'match-3', pairAId: 'pair-1', pairBId: 'pair-3', scoreA: 15, scoreB: 21 },
              { id: 'match-4', pairAId: 'pair-4', pairBId: 'pair-2', scoreA: null, scoreB: null },
            ],
          },
          {
            id: 'round-3',
            number: 3,
            byePairId: null,
            matches: [
              { id: 'match-5', pairAId: 'pair-1', pairBId: 'pair-2', scoreA: null, scoreB: null },
              { id: 'match-6', pairAId: 'pair-3', pairBId: 'pair-4', scoreA: null, scoreB: null },
            ],
          },
        ],
      },
    ],
  };
}

describe('migração de fixture V1 real com placares', () => {
  it('preserva times, rodadas, placares, lineups e resolve confrontos na UI', () => {
    const original = v1FourDoublesFixture();
    const snapshot = JSON.parse(JSON.stringify(original));
    const { document, migrated, sourceVersion } = interpretGameSessionsJson(JSON.stringify(original));
    const session = document.sessions[0];

    expect(migrated).toBe(true);
    expect(sourceVersion).toBe(1);
    expect(document.schemaVersion).toBe(2);
    expect(session.teams).toHaveLength(4);
    expect(session.teams.map((team) => team.id)).toEqual(['pair-1', 'pair-2', 'pair-3', 'pair-4']);
    expect(session.format).toEqual({ teamSize: 2, teamCount: 4 });
    expect(session.rounds).toHaveLength(3);
    expect(session.rounds.flatMap((round) => round.matches)).toHaveLength(6);
    expect(session).not.toHaveProperty('pairs');
    expect(JSON.stringify(session)).not.toContain('pairAId');
    expect(JSON.stringify(session)).not.toContain('byePairId');

    expect(session.rounds[0].matches[0]).toMatchObject({
      id: 'match-1',
      teamAId: 'pair-1',
      teamBId: 'pair-4',
      scoreA: 21,
      scoreB: 18,
      lineupA: [
        { playerId: 'p1', playerName: 'Erik' },
        { playerId: 'p2', playerName: 'André' },
      ],
      lineupB: [
        { playerId: 'p7', playerName: 'BH' },
        { playerId: 'p8', playerName: 'Arthur' },
      ],
    });
    expect(session.rounds[1].matches[0]).toMatchObject({
      scoreA: 15,
      scoreB: 21,
    });
    expect(countSessionMatches(session)).toEqual({
      total: 6,
      completed: 2,
      pending: 4,
      invalid: 0,
    });
    expect(teamSessionRoundSummary(session)).toMatchObject({
      roundCount: 3,
      matchCount: 6,
      completedCount: 2,
      pendingCount: 4,
    });

    for (const round of session.rounds) {
      expect(resolveByeLabel(session.teams, round.byeTeamId)).toBeNull();
      for (const match of round.matches) {
        expect(resolveTeamLabel(session.teams, match.teamAId)).not.toBe('Dupla não encontrada');
        expect(resolveTeamLabel(session.teams, match.teamBId)).not.toBe('Dupla não encontrada');
      }
    }

    expect(resolveTeamLabel(session.teams, 'pair-2')).toBe('Gabi + Luiza');
    expect(original).toEqual(snapshot);
  });
});
