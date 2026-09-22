import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MATCH_SOURCE_COMPETITION } from '../domain/performanceMatches.js';
import { assembleCloudCompetition, applyCompetitionMatchRealtimeChange } from './competitionMappers.js';
import { mapCloudPerformanceMatches } from './cloudPerformance.js';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from './client.js';
import { loadCloudCompetition } from './competitionApi.js';

const COMPETITION_ID = '667d0098-60e4-4f3b-8a4b-3094c76e6b51';
const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const MATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMBED_ERROR =
  "Could not embed because more than one relationship was found for 'competition_matches' and 'competition_match_players'";

function emptyTables() {
  return {
    competitions: [
      {
        id: COMPETITION_ID,
        created_by: OWNER_ID,
        name: 'Torneio cloud',
        date: '2026-09-21',
        status: 'draft',
        join_code: 'AB23CD56',
        format_team_size: 2,
        structure_version: 0,
        group_id: null,
        seed_team_ids: [],
        created_at: '2026-09-21T16:00:00.000Z',
        updated_at: '2026-09-21T16:00:00.000Z',
      },
    ],
    competition_members: [
      {
        competition_id: COMPETITION_ID,
        user_id: OWNER_ID,
        role: 'owner',
        profiles: { id: OWNER_ID, display_name: 'André' },
      },
    ],
    competition_players: [],
    competition_teams: [],
    competition_team_members: [],
    competition_stages: [
      {
        id: 'stage-1',
        competition_id: COMPETITION_ID,
        number: 1,
        name: 'Eliminatória',
        type: 'single_elimination',
        status: 'pending',
        config: {},
        seed_team_ids: [],
        seed_snapshot: null,
      },
    ],
    competition_rounds: [],
    competition_round_byes: [],
    competition_matches: [],
    competition_match_players: [],
    competition_match_events: [],
  };
}

function createClient(tables) {
  const fromCalls = [];
  const client = {
    fromCalls,
    from(table) {
      fromCalls.push(table);
      const state = { table, select: '*', filters: {}, maybeSingle: false };
      const builder = {
        select(spec) {
          state.select = spec;
          return builder;
        },
        eq(column, value) {
          state.filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          state.maybeSingle = true;
          return builder;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(run()).then(onFulfilled, onRejected);
        },
      };

      function run() {
        if (state.table === 'competition_matches' && /competition_match_players\s*\(/.test(state.select)) {
          return { data: null, error: { code: 'PGRST201', message: EMBED_ERROR } };
        }
        const rows = (tables[state.table] ?? []).filter((row) =>
          Object.entries(state.filters).every(([column, value]) => row[column] === value)
        );
        if (state.maybeSingle) return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      }

      return builder;
    },
  };
  return client;
}

describe('loadCloudCompetition', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  it('carrega draft em lote sem embed de match_players', async () => {
    const client = createClient(emptyTables());
    getSupabaseClient.mockReturnValue(client);
    const result = await loadCloudCompetition(COMPETITION_ID, OWNER_ID);
    expect(result.ok).toBe(true);
    expect(result.loaded.competition.status).toBe('draft');
    expect(result.loaded.myRole).toBe('owner');
    expect(result.loaded.competition.teams).toEqual([]);
    expect(client.fromCalls.filter((table) => table === 'competition_matches')).toHaveLength(1);
    expect(client.fromCalls.filter((table) => table === 'competition_match_players')).toHaveLength(1);
  });
});

describe('assembleCloudCompetition e performance', () => {
  it('mapeia partida cloud com sourceType competition e originKey', () => {
    const loaded = assembleCloudCompetition({
      competition: {
        id: COMPETITION_ID,
        name: 'Torneio',
        date: '2026-09-21',
        status: 'in_progress',
        format_team_size: 2,
        structure_version: 2,
        join_code: 'AB23CD56',
        seed_team_ids: [],
        created_at: '2026-09-21T16:00:00.000Z',
        updated_at: '2026-09-21T16:10:00.000Z',
      },
      members: [{ user_id: OWNER_ID, role: 'owner', profiles: { display_name: 'André' } }],
      players: [],
      teams: [{ id: 't1', competition_id: COMPETITION_ID, sort_index: 0 }],
      teamMembers: [
        {
          team_id: 't1',
          competition_id: COMPETITION_ID,
          player_id: 'p1',
          player_name_snapshot: 'André',
          sort_index: 0,
        },
      ],
      stages: [
        {
          id: 's1',
          competition_id: COMPETITION_ID,
          number: 1,
          name: 'Final',
          type: 'single_elimination',
          status: 'in_progress',
          config: {},
          seed_team_ids: ['t1'],
        },
      ],
      rounds: [{ id: 'r1', competition_id: COMPETITION_ID, stage_id: 's1', number: 1, name: 'Final', bracket: 'winners' }],
      byes: [],
      matches: [
        {
          id: MATCH_ID,
          competition_id: COMPETITION_ID,
          stage_id: 's1',
          round_id: 'r1',
          source_a: { type: 'team', teamId: 't1' },
          source_b: { type: 'team', teamId: 't2' },
          team_a_id: 't1',
          team_b_id: 't2',
          score_a: 21,
          score_b: 18,
          version: 1,
        },
      ],
      matchPlayers: [
        {
          match_id: MATCH_ID,
          player_id: 'p1',
          player_name_snapshot: 'André',
          side: 'a',
          sort_index: 0,
        },
        {
          match_id: MATCH_ID,
          player_id: 'p2',
          player_name_snapshot: 'Paulo',
          side: 'b',
          sort_index: 0,
        },
      ],
      events: [],
      myUserId: OWNER_ID,
    });

    expect(loaded.competition.stages[0].rounds[0].matches[0]).toMatchObject({
      id: MATCH_ID,
      scoreA: 21,
      scoreB: 18,
      lineupA: [{ playerId: 'p1', playerName: 'André' }],
    });

    const mapped = mapCloudPerformanceMatches([
      {
        source_kind: 'competition',
        competition_id: COMPETITION_ID,
        session_id: null,
        session_name: 'Torneio',
        session_date: '2026-09-21',
        session_updated_at: '2026-09-21T16:10:00.000Z',
        session_created_at: '2026-09-21T16:00:00.000Z',
        legacy_source_id: null,
        round_id: 'r1',
        round_number: 1,
        match_id: MATCH_ID,
        score_a: 21,
        score_b: 18,
        lineup_a: [{ player_id: 'p1', player_name_snapshot: 'André' }],
        lineup_b: [{ player_id: 'p2', player_name_snapshot: 'Paulo' }],
      },
    ]);
    expect(mapped[0].sourceType).toBe(MATCH_SOURCE_COMPETITION);
    expect(mapped[0].originKey).toBe(COMPETITION_ID);
  });

  it('patch de realtime só aplica version mais nova', () => {
    const loaded = {
      competition: {
        stages: [{ rounds: [{ matches: [{ id: MATCH_ID, scoreA: 21, scoreB: 18 }] }] }],
      },
      matchVersions: { [MATCH_ID]: 1 },
    };
    const ignored = applyCompetitionMatchRealtimeChange(loaded, { id: MATCH_ID, version: 1, score_a: 99, score_b: 0 });
    expect(ignored).toBe(loaded);
    const next = applyCompetitionMatchRealtimeChange(loaded, { id: MATCH_ID, version: 2, score_a: 21, score_b: 15 });
    expect(next.competition.stages[0].rounds[0].matches[0].scoreB).toBe(15);
    expect(next.matchVersions[MATCH_ID]).toBe(2);
  });
});
