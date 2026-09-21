import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from './client.js';
import { loadCloudSession } from './sessionApi.js';

const SESSION_ID = '667d0098-60e4-4f3b-8a4b-3094c76e6b51';
const OWNER_ID = 'owner-1';
const EMBED_ERROR =
  "Could not embed because more than one relationship was found for 'matches' and 'match_players'";

function emptyDraftTables() {
  return {
    sessions: [
      {
        id: SESSION_ID,
        created_by: OWNER_ID,
        name: 'Teste Supabase',
        date: '2026-09-21',
        status: 'draft',
        join_code: 'AB23CD56',
        team_size: 2,
        team_count: 2,
        structure_version: 0,
        created_at: '2026-09-21T16:00:00.000Z',
        updated_at: '2026-09-21T16:00:00.000Z',
      },
    ],
    session_members: [
      {
        session_id: SESSION_ID,
        user_id: OWNER_ID,
        role: 'owner',
        profiles: { id: OWNER_ID, display_name: 'André' },
      },
    ],
    teams: [],
    rounds: [],
    matches: [],
    match_players: [],
    session_players: [],
    match_events: [],
  };
}

function sessionWithLineupsTables() {
  const tables = emptyDraftTables();
  tables.sessions[0].status = 'in_progress';
  tables.sessions[0].structure_version = 4;
  tables.rounds = [
    { id: 'r1', session_id: SESSION_ID, number: 1, cycle_number: 1, bye_team_id: null },
  ];
  tables.matches = [
    {
      id: 'm1',
      session_id: SESSION_ID,
      round_id: 'r1',
      team_a_id: 't1',
      team_b_id: 't2',
      score_a: 21,
      score_b: 18,
      version: 2,
      updated_by: OWNER_ID,
      updated_at: '2026-09-21T16:10:00.000Z',
    },
  ];
  tables.match_players = [
    { match_id: 'm1', session_id: SESSION_ID, player_id: 'p1', player_name_snapshot: 'João', side: 'a', sort_index: 0 },
    { match_id: 'm1', session_id: SESSION_ID, player_id: 'p2', player_name_snapshot: 'Ana', side: 'b', sort_index: 0 },
  ];
  return tables;
}

function createAmbiguousFkClient(tables) {
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
        if (state.table === 'matches' && /match_players\s*\(/.test(state.select)) {
          return {
            data: null,
            error: { code: 'PGRST201', message: EMBED_ERROR },
          };
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

describe('loadCloudSession com FKs duplicadas matches <-> match_players', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  it('não usa embed ambíguo e carrega draft vazio', async () => {
    const client = createAmbiguousFkClient(emptyDraftTables());
    getSupabaseClient.mockReturnValue(client);

    const result = await loadCloudSession(SESSION_ID, OWNER_ID);

    expect(result.ok).toBe(true);
    expect(result.session).toMatchObject({
      id: SESSION_ID,
      status: 'draft',
      myRole: 'owner',
      teams: [],
      rounds: [],
      players: [],
    });
    expect(client.fromCalls.filter((table) => table === 'matches')).toHaveLength(1);
    expect(client.fromCalls.filter((table) => table === 'match_players')).toHaveLength(1);
    expect(client.fromCalls).toHaveLength(8);
  });

  it('agrupa lineups da sessão em uma consulta e mapeia matches', async () => {
    const client = createAmbiguousFkClient(sessionWithLineupsTables());
    getSupabaseClient.mockReturnValue(client);

    const result = await loadCloudSession(SESSION_ID, OWNER_ID);

    expect(result.ok).toBe(true);
    expect(result.session.rounds).toHaveLength(1);
    expect(result.session.rounds[0].matches[0]).toMatchObject({
      id: 'm1',
      scoreA: 21,
      scoreB: 18,
      lineupA: [{ playerId: 'p1', playerName: 'João' }],
      lineupB: [{ playerId: 'p2', playerName: 'Ana' }],
    });
    expect(client.fromCalls.filter((table) => table === 'match_players')).toHaveLength(1);
  });

  it('falharia se ainda tentasse embeder match_players a partir de matches', async () => {
    const client = createAmbiguousFkClient(sessionWithLineupsTables());
    const { data, error } = await client
      .from('matches')
      .select('*, match_players(player_id, player_name_snapshot, side, sort_index)')
      .eq('session_id', SESSION_ID);
    expect(data).toBeNull();
    expect(error.message).toBe(EMBED_ERROR);
  });
});
