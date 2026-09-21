import { describe, expect, it } from 'vitest';
import {
  applyMatchRealtimeChange,
  attachMatchPlayersToMatches,
  mapCloudSession,
  mapMatch,
} from './mappers.js';

describe('cloud session mappers', () => {
  it('mapeia snapshots de lineup sem usar o nome vivo do elenco', () => {
    const match = mapMatch({
      id: 'm1',
      session_id: 's1',
      round_id: 'r1',
      team_a_id: 't1',
      team_b_id: 't2',
      score_a: 21,
      score_b: 18,
      version: 2,
      updated_by: 'u1',
      updated_at: '2026-09-21T12:00:00Z',
      match_players: [
        { player_id: 'p1', player_name_snapshot: 'João', side: 'a', sort_index: 0 },
        { player_id: 'p2', player_name_snapshot: 'Ana', side: 'b', sort_index: 0 },
      ],
    });

    expect(match.lineupA).toEqual([{ playerId: 'p1', playerName: 'João' }]);
    expect(match.scoreA).toBe(21);
    expect(match.version).toBe(2);
  });

  it('expõe o papel do usuário e os display names dos membros', () => {
    const session = mapCloudSession({
      myUserId: 'u2',
      session: {
        id: 's1',
        created_by: 'u1',
        name: 'Pelada',
        date: '2026-09-21',
        status: 'in_progress',
        join_code: 'AB12CD34',
        team_size: 2,
        team_count: 2,
      },
      members: [
        { session_id: 's1', user_id: 'u1', role: 'owner', profiles: { display_name: 'Patroa' } },
        { session_id: 's1', user_id: 'u2', role: 'member', profiles: { display_name: 'Ana' } },
      ],
      teams: [],
      rounds: [{ id: 'r1', session_id: 's1', number: 1, cycle_number: 1, bye_team_id: null }],
      matches: [],
    });

    expect(session.myRole).toBe('member');
    expect(session.structureVersion).toBe(0);
    expect(session.members.map((member) => member.displayName)).toEqual(['Patroa', 'Ana']);
    expect(session.rounds[0].cycleNumber).toBe(1);
  });

  it('agrupa match_players por match_id sem alterar o formato de mapMatch', () => {
    const matches = attachMatchPlayersToMatches(
      [
        { id: 'm1', session_id: 's1', round_id: 'r1', team_a_id: 't1', team_b_id: 't2' },
        { id: 'm2', session_id: 's1', round_id: 'r1', team_a_id: 't2', team_b_id: 't1' },
      ],
      [
        { match_id: 'm1', player_id: 'p1', player_name_snapshot: 'João', side: 'a', sort_index: 0 },
        { match_id: 'm2', player_id: 'p4', player_name_snapshot: 'Lia', side: 'b', sort_index: 0 },
        { match_id: 'm1', player_id: 'p2', player_name_snapshot: 'Ana', side: 'b', sort_index: 0 },
      ]
    );

    expect(mapMatch(matches[0]).lineupA).toEqual([{ playerId: 'p1', playerName: 'João' }]);
    expect(mapMatch(matches[0]).lineupB).toEqual([{ playerId: 'p2', playerName: 'Ana' }]);
    expect(mapMatch(matches[1]).lineupB).toEqual([{ playerId: 'p4', playerName: 'Lia' }]);
    expect(mapMatch(matches[1]).lineupA).toEqual([]);
    expect(attachMatchPlayersToMatches([], [])).toEqual([]);
    expect(attachMatchPlayersToMatches(null, null)).toEqual([]);
  });

  it('mapeia rascunho recém-criado sem estrutura', () => {
    const session = mapCloudSession({
      myUserId: 'u1',
      session: {
        id: 's-new',
        created_by: 'u1',
        name: 'Teste Supabase',
        date: '2026-09-21',
        status: 'draft',
        join_code: 'AB23CD56',
        team_size: 2,
        team_count: 2,
      },
      members: [{ session_id: 's-new', user_id: 'u1', role: 'owner', profiles: { display_name: 'André' } }],
      teams: [],
      rounds: [],
      matches: [],
      sessionPlayers: [],
      matchEvents: [],
    });
    expect(session.teams).toEqual([]);
    expect(session.rounds).toEqual([]);
    expect(session.players).toEqual([]);
    expect(session.myRole).toBe('owner');
  });
});

describe('applyMatchRealtimeChange', () => {
  const session = {
    id: 's1',
    rounds: [
      {
        id: 'r1',
        matches: [
          {
            id: 'm1',
            scoreA: 10,
            scoreB: 8,
            version: 3,
            updatedBy: 'u1',
          },
        ],
      },
    ],
  };

  it('aplica placar só quando a version é mais nova', () => {
    const next = applyMatchRealtimeChange(session, {
      id: 'm1',
      score_a: 21,
      score_b: 18,
      version: 4,
      updated_by: 'u2',
    });
    expect(next.rounds[0].matches[0].scoreA).toBe(21);
    expect(next.rounds[0].matches[0].version).toBe(4);
  });

  it('ignora evento antigo ou duplicado', () => {
    expect(
      applyMatchRealtimeChange(session, {
        id: 'm1',
        score_a: 99,
        score_b: 1,
        version: 3,
      })
    ).toBe(session);
    expect(
      applyMatchRealtimeChange(session, {
        id: 'm1',
        score_a: 99,
        score_b: 1,
        version: 2,
      })
    ).toBe(session);
  });
});
