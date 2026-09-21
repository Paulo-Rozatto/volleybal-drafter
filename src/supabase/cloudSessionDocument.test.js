import { describe, expect, it } from 'vitest';
import {
  parseScoreConflictDetail,
  roundsPlanFromSession,
  shouldAcceptCloudSession,
  teamsPlanFromSession,
} from './cloudSessionDocument.js';
import { isScoreOnlyMatchUpdate } from '../hooks/useCloudSessionRealtime.js';

describe('cloud session plans', () => {
  const session = {
    structureVersion: 4,
    teams: [
      {
        id: 't1',
        name: 'A',
        sortIndex: 0,
        members: [{ playerId: 'p1', playerName: 'João' }],
      },
    ],
    rounds: [
      {
        id: 'r1',
        number: 1,
        cycleNumber: 2,
        byeTeamId: null,
        matches: [
          {
            id: 'm1',
            teamAId: 't1',
            teamBId: 't2',
            lineupA: [{ playerId: 'p1', playerName: 'João' }],
            lineupB: [{ playerId: 'p2', playerName: 'Ana' }],
          },
        ],
      },
    ],
  };

  it('exporta IDs do domínio sem regenerar', () => {
    expect(teamsPlanFromSession(session)[0].id).toBe('t1');
    expect(roundsPlanFromSession(session)[0].id).toBe('r1');
    expect(roundsPlanFromSession(session)[0].matches[0].id).toBe('m1');
    expect(roundsPlanFromSession(session, { cycleNumber: 2 })).toHaveLength(1);
    expect(roundsPlanFromSession(session, { cycleNumber: 1 })).toHaveLength(0);
  });

  it('recusa estado com structure_version mais antigo', () => {
    expect(shouldAcceptCloudSession(session, { structureVersion: 3 })).toBe(false);
    expect(shouldAcceptCloudSession(session, { structureVersion: 4 })).toBe(true);
    expect(shouldAcceptCloudSession(session, { structureVersion: 5 })).toBe(true);
  });

  it('lê o detalhe JSON do conflito de placar', () => {
    expect(
      parseScoreConflictDetail({ details: '{"score_a":21,"score_b":18,"version":4}' })
    ).toEqual({ scoreA: 21, scoreB: 18, version: 4 });
  });
});

describe('isScoreOnlyMatchUpdate', () => {
  it('trata UPDATE de placar como patch local', () => {
    expect(
      isScoreOnlyMatchUpdate({
        eventType: 'UPDATE',
        new: {
          id: 'm1',
          score_a: 21,
          version: 2,
          round_id: 'r1',
          team_a_id: 't1',
          team_b_id: 't2',
          session_id: 's1',
        },
        old: {
          id: 'm1',
          round_id: 'r1',
          team_a_id: 't1',
          team_b_id: 't2',
          session_id: 's1',
        },
      })
    ).toBe(true);
  });

  it('refetch quando a estrutura da partida muda', () => {
    expect(
      isScoreOnlyMatchUpdate({
        eventType: 'UPDATE',
        new: { id: 'm1', round_id: 'r2', team_a_id: 't1', team_b_id: 't2', session_id: 's1' },
        old: { id: 'm1', round_id: 'r1', team_a_id: 't1', team_b_id: 't2', session_id: 's1' },
      })
    ).toBe(false);
    expect(isScoreOnlyMatchUpdate({ eventType: 'INSERT', new: { id: 'm1' } })).toBe(false);
  });
});
