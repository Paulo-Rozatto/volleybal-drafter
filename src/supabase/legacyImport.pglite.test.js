import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyCompetitionMatchResult,
  createDraftCompetition,
  generateCompetitionBracket,
  listCompetitionMatches,
  setDraftCompetitionTeams,
} from '../domain/competition.js';
import { MATCH_SOURCE_COMPETITION, MATCH_SOURCE_SESSION } from '../domain/performanceMatches.js';
import { mapCloudPerformanceMatches } from './cloudPerformance.js';
import { remapSessionPlayersForCompare, verifyImportedSession } from '../migration/legacyMigration.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const preludeSql = readFileSync(join(root, 'supabase/tests/pglite_prelude.sql'), 'utf8');
const etapa1Sql = readFileSync(join(root, 'supabase/migrations/20260921120000_cloud_sessions.sql'), 'utf8');
const etapa2Sql = readFileSync(join(root, 'supabase/migrations/20260921140000_cloud_sessions_etapa2.sql'), 'utf8');
const etapa3Sql = readFileSync(join(root, 'supabase/migrations/20260921160000_player_identity_performance.sql'), 'utf8');
const etapa4Sql = readFileSync(join(root, 'supabase/migrations/20260921180000_cloud_groups.sql'), 'utf8');
const etapa5Sql = readFileSync(join(root, 'supabase/migrations/20260921200000_group_performance.sql'), 'utf8');
const etapa6Sql = readFileSync(join(root, 'supabase/migrations/20260921220000_cloud_competitions.sql'), 'utf8');
const etapa7Sql = readFileSync(join(root, 'supabase/migrations/20260922000000_legacy_import.sql'), 'utf8');

const ISO = '2026-09-12T18:00:00.000Z';

async function asUser(db, userId, run) {
  await db.exec('begin');
  try {
    if (userId) {
      await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
      await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    } else {
      await db.exec(`select set_config('request.jwt.claim.sub', '', true)`);
      await db.exec(`select set_config('request.jwt.claims', '{}', true)`);
    }
    await db.exec('set local role authenticated');
    const result = await run();
    await db.exec('commit');
    return result;
  } catch (error) {
    try {
      await db.exec('rollback');
    } catch {
      // aborted
    }
    throw error;
  }
}

async function asAnon(db, run) {
  await db.exec('begin');
  try {
    await db.exec(`select set_config('request.jwt.claim.sub', '', true)`);
    await db.exec(`select set_config('request.jwt.claims', '{}', true)`);
    await db.exec('set local role anon');
    const result = await run();
    await db.exec('commit');
    return result;
  } catch (error) {
    try {
      await db.exec('rollback');
    } catch {
      // aborted
    }
    throw error;
  }
}

async function insertUser(db, id, email, name) {
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)',
    [id, email, JSON.stringify({ display_name: name })]
  );
}

function payloadOf(row) {
  const value = row.payload ?? Object.values(row)[0];
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function member(playerId, playerName) {
  return { playerId, playerName };
}

function guest(id, name) {
  return { id, name, score: 3, gender: 'M', height: 'short' };
}

async function importPlayer(db, userId, player, cloudPlayerId = null, batchId = null) {
  const result = await asUser(db, userId, () =>
    db.query('select public.import_legacy_player($1, $2, $3, $4, $5, $6, $7) as payload', [
      player.id,
      player.name,
      player.score ?? 3,
      player.gender ?? 'M',
      player.height ?? 'short',
      cloudPlayerId,
      batchId,
    ])
  );
  return payloadOf(result.rows[0]);
}

async function importSession(db, userId, session, batchId = null) {
  const result = await asUser(db, userId, () =>
    db.query('select public.import_legacy_session($1, $2::jsonb, $3) as payload', [
      session.id,
      JSON.stringify(session),
      batchId,
    ])
  );
  return payloadOf(result.rows[0]);
}

async function importCompetition(db, userId, competition, batchId = null) {
  const result = await asUser(db, userId, () =>
    db.query('select public.import_legacy_competition($1, $2::jsonb, $3) as payload', [
      competition.id,
      JSON.stringify(competition),
      batchId,
    ])
  );
  return payloadOf(result.rows[0]);
}

async function startBatch(db, userId) {
  const result = await asUser(db, userId, () =>
    db.query("select public.start_legacy_import_batch('gist', 'fp') as payload")
  );
  return payloadOf(result.rows[0]);
}

async function finishBatch(db, userId, batchId, status) {
  await asUser(db, userId, () =>
    db.query('select public.finish_legacy_import_batch($1, $2)', [batchId, status])
  );
}

async function expectCode(run, code, hidden = []) {
  let caught = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code}`).toBeTruthy();
  const message = String(caught?.message ?? caught);
  expect(message).toMatch(new RegExp(code));
  for (const snippet of hidden) {
    if (snippet) expect(message).not.toContain(String(snippet));
  }
}

async function importPlayersOf(db, userId, players) {
  const map = new Map();
  for (const player of players) {
    const imported = await importPlayer(db, userId, player);
    map.set(player.id, imported.cloud_id);
  }
  return map;
}

function scoredSession({ id, status = 'in_progress', players }) {
  const [a, b, c, d] = players;
  const teamA = crypto.randomUUID();
  const teamB = crypto.randomUUID();
  return {
    id,
    date: '2026-09-12',
    name: 'Encontro legado',
    status,
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 2 },
    teams: [
      { id: teamA, members: [member(a.id, a.name), member(b.id, b.name)] },
      { id: teamB, members: [member(c.id, c.name), member(d.id, d.name)] },
    ],
    rounds: [
      {
        id: crypto.randomUUID(),
        number: 1,
        cycleNumber: 1,
        byeTeamId: null,
        matches: [
          {
            id: crypto.randomUUID(),
            teamAId: teamA,
            teamBId: teamB,
            lineupA: [member(a.id, a.name), member(b.id, b.name)],
            lineupB: [member(c.id, c.name), member(d.id, d.name)],
            scoreA: 21,
            scoreB: 18,
          },
        ],
      },
    ],
  };
}

describe('etapa 7 legacy import', () => {
  let db;
  let andre;
  let paulo;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(preludeSql);
    await db.exec(etapa1Sql);
    await db.exec(etapa2Sql);
    await db.exec(etapa3Sql);
    await db.exec(etapa4Sql);
    await db.exec(etapa5Sql);
    await db.exec(etapa6Sql);
    await db.exec(etapa7Sql);
    andre = crypto.randomUUID();
    paulo = crypto.randomUUID();
    await insertUser(db, andre, 'andre@example.com', 'André');
    await insertUser(db, paulo, 'paulo@example.com', 'Paulo');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('player novo cria cloud guest, retry é idempotente e nome igual não mescla', async () => {
    const joaoA = guest('legacy-joao-a', 'João');
    const joaoB = guest('legacy-joao-b', 'João');
    const first = await importPlayer(db, andre, joaoA);
    const retry = await importPlayer(db, andre, joaoA);
    const second = await importPlayer(db, andre, joaoB);
    expect(first.status).toBe('imported');
    expect(retry.status).toBe('already_imported');
    expect(retry.cloud_id).toBe(first.cloud_id);
    expect(second.cloud_id).not.toBe(first.cloud_id);

    const players = (
      await db.query('select id, name, linked_user_id, created_by from public.players where id = any($1::uuid[])', [
        [first.cloud_id, second.cloud_id],
      ])
    ).rows;
    expect(players).toHaveLength(2);
    expect(players.every((row) => row.name === 'João')).toBe(true);
    expect(players.every((row) => row.linked_user_id == null)).toBe(true);
    expect(players.every((row) => row.created_by === andre)).toBe(true);
  });

  it('mapping explícito reutiliza; mapping inválido falha; linked_user_id não muda', async () => {
    const cloudId = crypto.randomUUID();
    await asUser(db, andre, () =>
      db.query(
        `insert into public.players (id, name, skill_score, gender, height, created_by)
         values ($1, 'André', 4, 'M', 'short', $2)`,
        [cloudId, andre]
      )
    );
    const mapped = await importPlayer(db, andre, guest('legacy-andre', 'André'), cloudId);
    expect(mapped.cloud_id).toBe(cloudId);
    const linked = (await db.query('select linked_user_id from public.players where id = $1', [cloudId])).rows[0];
    expect(linked.linked_user_id).toBeNull();

    await expect(importPlayer(db, andre, guest('legacy-other', 'Outro'), crypto.randomUUID())).rejects.toThrow(
      /PLAYER_MAPPING_INVALID/
    );
  });

  it('session nova importa atomicamente, preserva histórico e retry é already_imported', async () => {
    const players = [
      guest('s-p1', 'André'),
      guest('s-p2', 'Ana'),
      guest('s-p3', 'Bruno'),
      guest('s-p4', 'Carla'),
    ];
    const playerMap = await importPlayersOf(db, andre, players);
    const session = scoredSession({ id: 'sess-legado-1', status: 'finished', players });
    const imported = await importSession(db, andre, session);
    expect(imported.status).toBe('imported');

    const row = (await db.query('select * from public.sessions where id = $1', [imported.cloud_id])).rows[0];
    expect(row.legacy_source_id).toBe('sess-legado-1');
    expect(row.created_by).toBe(andre);
    expect(row.group_id).toBeNull();
    expect(row.status).toBe('finished');

    const members = (await db.query('select user_id, role from public.session_members where session_id = $1', [
      imported.cloud_id,
    ])).rows;
    expect(members).toEqual([{ user_id: andre, role: 'owner' }]);

    const roster = (await db.query('select player_id from public.session_players where session_id = $1', [
      imported.cloud_id,
    ])).rows;
    expect(roster).toHaveLength(4);

    const teams = (await db.query('select id from public.teams where session_id = $1', [imported.cloud_id])).rows;
    expect(teams).toHaveLength(2);
    const rounds = (await db.query('select id from public.rounds where session_id = $1', [imported.cloud_id])).rows;
    expect(rounds).toHaveLength(1);
    const match = (await db.query('select score_a, score_b, version, updated_by from public.matches where session_id = $1', [
      imported.cloud_id,
    ])).rows[0];
    expect(match.score_a).toBe(21);
    expect(match.score_b).toBe(18);
    expect(Number(match.version)).toBe(0);
    expect(match.updated_by).toBeNull();
    const events = (await db.query('select count(*)::int as n from public.match_events where session_id = $1', [
      imported.cloud_id,
    ])).rows[0];
    expect(events.n).toBe(0);

    const lineup = (
      await db.query('select count(*)::int as n from public.match_players where session_id = $1', [imported.cloud_id])
    ).rows[0];
    expect(lineup.n).toBe(4);

    const retry = await importSession(db, andre, session);
    expect(retry.status).toBe('already_imported');
    expect(retry.cloud_id).toBe(imported.cloud_id);
    const count = (
      await db.query('select count(*)::int as n from public.sessions where legacy_source_id = $1', ['sess-legado-1'])
    ).rows[0];
    expect(count.n).toBe(1);

    const assembled = {
      id: row.id,
      status: row.status,
      groupId: row.group_id,
      teams: teams.map((team) => ({ id: team.id })),
      rounds: [{ matches: [{ scoreA: match.score_a, scoreB: match.score_b }] }],
    };
    expect(verifyImportedSession(remapSessionPlayersForCompare(session, playerMap), assembled, new Map()).ok).toBe(true);
  });

  it('falha no meio não deixa session parcial; session inválida não impede outra', async () => {
    const players = [
      guest('bad-p1', 'A'),
      guest('bad-p2', 'B'),
      guest('ok-p1', 'C'),
      guest('ok-p2', 'D'),
      guest('ok-p3', 'E'),
      guest('ok-p4', 'F'),
    ];
    await importPlayersOf(db, andre, players);
    const goodShape = scoredSession({ id: 'sess-broken', players: players.slice(0, 4) });
    goodShape.rounds[0].matches[0].scoreA = 21;
    goodShape.rounds[0].matches[0].scoreB = 21;
    await expect(importSession(db, andre, goodShape)).rejects.toThrow();
    expect(
      (await db.query('select count(*)::int as n from public.sessions where legacy_source_id = $1', ['sess-broken']))
        .rows[0].n
    ).toBe(0);

    const good = scoredSession({ id: 'sess-good-after-bad', players: players.slice(2) });
    const imported = await importSession(db, andre, good);
    expect(imported.status).toBe('imported');
  });

  it('o mesmo player legado em duas entidades aponta para o mesmo cloud player', async () => {
    const shared = [
      guest('shared-1', 'Lia'),
      guest('shared-2', 'Mel'),
      guest('shared-3', 'Nico'),
      guest('shared-4', 'Otto'),
    ];
    const map = await importPlayersOf(db, andre, shared);
    const first = await importSession(db, andre, scoredSession({ id: 'sess-share-a', players: shared }));
    const second = await importSession(db, andre, scoredSession({ id: 'sess-share-b', players: shared }));
    const rosterA = (
      await db.query('select player_id from public.session_players where session_id = $1 order by player_id', [
        first.cloud_id,
      ])
    ).rows.map((row) => row.player_id);
    const rosterB = (
      await db.query('select player_id from public.session_players where session_id = $1 order by player_id', [
        second.cloud_id,
      ])
    ).rows.map((row) => row.player_id);
    expect(rosterA).toEqual(rosterB);
    expect(rosterA).toEqual([...map.values()].sort());
  });

  it('session sem mapping de player falha inteira', async () => {
    const session = scoredSession({
      id: 'sess-needs-map',
      players: [
        guest('missing-1', 'X'),
        guest('missing-2', 'Y'),
        guest('missing-3', 'Z'),
        guest('missing-4', 'W'),
      ],
    });
    await expect(importSession(db, andre, session)).rejects.toThrow(/NEEDS_PLAYER_MAPPING/);
    expect(
      (await db.query('select count(*)::int as n from public.sessions where legacy_source_id = $1', ['sess-needs-map']))
        .rows[0].n
    ).toBe(0);
  });

  it('import concorrente do mesmo legacy_source_id não duplica', async () => {
    const players = [
      guest('race-1', 'A'),
      guest('race-2', 'B'),
      guest('race-3', 'C'),
      guest('race-4', 'D'),
    ];
    await importPlayersOf(db, andre, players);
    const session = scoredSession({ id: 'sess-race', players });
    const first = await importSession(db, andre, session);
    const second = await importSession(db, andre, session);
    expect(first.status).toBe('imported');
    expect(second.status).toBe('already_imported');
    expect(
      (await db.query('select count(*)::int as n from public.sessions where legacy_source_id = $1', ['sess-race']))
        .rows[0].n
    ).toBe(1);
  });

  it('competitions draft, in_progress, finished, swiss, DE, round robin e groups importam sem audit falso', async () => {
    async function playersForTeams(teams) {
      const list = [];
      for (const team of teams) {
        for (const item of team.members) {
          list.push(guest(item.playerId, item.playerName));
        }
      }
      return importPlayersOf(db, andre, list);
    }

    const draft = createDraftCompetition(
      { name: 'Draft legado', date: '2026-09-12', format: { teamSize: 2 } },
      { now: () => new Date(ISO) }
    );
    await playersForTeams(draft.teams);
    const importedDraft = await importCompetition(db, andre, draft);
    expect(importedDraft.status).toBe('imported');
    const draftRow = (await db.query('select status, group_id, created_by, legacy_source_id from public.competitions where id = $1', [
      importedDraft.cloud_id,
    ])).rows[0];
    expect(draftRow.status).toBe('draft');
    expect(draftRow.group_id).toBeNull();
    expect(draftRow.created_by).toBe(andre);
    expect(draftRow.legacy_source_id).toBe(draft.id);

    const teams = [
      { id: 't1', members: [member('c1a', 'A1'), member('c1b', 'B1')] },
      { id: 't2', members: [member('c2a', 'A2'), member('c2b', 'B2')] },
      { id: 't3', members: [member('c3a', 'A3'), member('c3b', 'B3')] },
      { id: 't4', members: [member('c4a', 'A4'), member('c4b', 'B4')] },
    ];

    const se = createDraftCompetition(
      { name: 'SE', date: '2026-09-12', format: { teamSize: 2 } },
      { now: () => new Date(ISO) }
    );
    const seTeams = setDraftCompetitionTeams(se, teams);
    const seGen = generateCompetitionBracket(seTeams.competition, { seedTeamIds: teams.map((team) => team.id) });
    expect(seGen.ok).toBe(true);
    const seMatch = listCompetitionMatches(seGen.competition)[0];
    const sePlayed = applyCompetitionMatchResult(seGen.competition, seMatch.id, {
      scoreA: 21,
      scoreB: 15,
      playedDate: '2026-09-12',
    });
    expect(sePlayed.ok).toBe(true);
    sePlayed.competition.status = 'in_progress';
    await playersForTeams(teams);
    const importedSe = await importCompetition(db, andre, sePlayed.competition);
    expect(importedSe.status).toBe('imported');
    const seScore = (
      await db.query(
        'select score_a, score_b, version, updated_by from public.competition_matches where competition_id = $1 and score_a is not null',
        [importedSe.cloud_id]
      )
    ).rows[0];
    expect(seScore.score_a).toBe(21);
    expect(Number(seScore.version)).toBe(0);
    expect(seScore.updated_by).toBeNull();
    expect(
      (
        await db.query('select count(*)::int as n from public.competition_match_events where competition_id = $1', [
          importedSe.cloud_id,
        ])
      ).rows[0].n
    ).toBe(0);

    const finished = JSON.parse(JSON.stringify(sePlayed.competition));
    finished.id = crypto.randomUUID();
    finished.name = 'Finished';
    finished.status = 'finished';
    const importedFinished = await importCompetition(db, andre, finished);
    expect(
      (await db.query('select status from public.competitions where id = $1', [importedFinished.cloud_id])).rows[0]
        .status
    ).toBe('finished');

    const swiss = createDraftCompetition(
      {
        name: 'Swiss',
        date: '2026-09-12',
        format: { teamSize: 2 },
        stages: [{ type: 'swiss', config: { roundCount: 1 } }],
      },
      { now: () => new Date(ISO) }
    );
    const swissTeams = [
      { id: 'st1', members: [member('sw1a', 'S1'), member('sw1b', 'S2')] },
      { id: 'st2', members: [member('sw2a', 'S3'), member('sw2b', 'S4')] },
      { id: 'st3', members: [member('sw3a', 'S5'), member('sw3b', 'S6')] },
      { id: 'st4', members: [member('sw4a', 'S7'), member('sw4b', 'S8')] },
    ];
    await playersForTeams(swissTeams);
    const swissReady = setDraftCompetitionTeams(swiss, swissTeams);
    const swissGen = generateCompetitionBracket(swissReady.competition, {
      seedTeamIds: swissTeams.map((team) => team.id),
    });
    expect(swissGen.ok).toBe(true);
    const swissImported = await importCompetition(db, andre, swissGen.competition);
    expect(swissImported.status).toBe('imported');
    expect(
      (await db.query('select type from public.competition_stages where competition_id = $1', [swissImported.cloud_id]))
        .rows[0].type
    ).toBe('swiss');

    const de = createDraftCompetition(
      {
        name: 'DE',
        date: '2026-09-12',
        format: { teamSize: 2 },
        stages: [{ type: 'double_elimination', config: { grandFinalMode: 'single_final' } }],
      },
      { now: () => new Date(ISO) }
    );
    const deTeams = [
      { id: 'dt1', members: [member('de1a', 'D1'), member('de1b', 'D2')] },
      { id: 'dt2', members: [member('de2a', 'D3'), member('de2b', 'D4')] },
      { id: 'dt3', members: [member('de3a', 'D5'), member('de3b', 'D6')] },
      { id: 'dt4', members: [member('de4a', 'D7'), member('de4b', 'D8')] },
    ];
    await playersForTeams(deTeams);
    const deReady = setDraftCompetitionTeams(de, deTeams);
    const deGen = generateCompetitionBracket(deReady.competition, { seedTeamIds: deTeams.map((team) => team.id) });
    const deImported = await importCompetition(db, andre, deGen.competition);
    expect(
      (await db.query('select type from public.competition_stages where competition_id = $1', [deImported.cloud_id]))
        .rows[0].type
    ).toBe('double_elimination');

    const rrTeams = [
      { id: 'rt1', members: [member('rr1a', 'R1'), member('rr1b', 'R2')] },
      { id: 'rt2', members: [member('rr2a', 'R3'), member('rr2b', 'R4')] },
    ];
    await playersForTeams(rrTeams);
    const rr = {
      id: crypto.randomUUID(),
      name: 'RR',
      date: '2026-09-12',
      status: 'in_progress',
      createdAt: ISO,
      updatedAt: ISO,
      format: { teamSize: 2 },
      seedTeamIds: ['rt1', 'rt2'],
      teams: rrTeams,
      stages: [
        {
          id: crypto.randomUUID(),
          number: 1,
          name: 'Todos contra todos',
          type: 'round_robin',
          status: 'in_progress',
          config: {},
          seedTeamIds: ['rt1', 'rt2'],
          seedSnapshot: null,
          rounds: [
            {
              id: crypto.randomUUID(),
              number: 1,
              name: 'Rodada 1',
              byes: [],
              matches: [
                {
                  id: crypto.randomUUID(),
                  sourceA: { type: 'team', teamId: 'rt1' },
                  sourceB: { type: 'team', teamId: 'rt2' },
                  teamAId: 'rt1',
                  teamBId: 'rt2',
                  lineupA: rrTeams[0].members,
                  lineupB: rrTeams[1].members,
                  scoreA: 21,
                  scoreB: 19,
                  playedDate: '2026-09-12',
                  winnerTeamId: 'rt1',
                },
              ],
            },
          ],
        },
      ],
    };
    const rrImported = await importCompetition(db, andre, rr);
    expect(
      (await db.query('select type from public.competition_stages where competition_id = $1', [rrImported.cloud_id]))
        .rows[0].type
    ).toBe('round_robin');

    const groupTeams = [
      { id: 'gt1', members: [member('g1a', 'G1'), member('g1b', 'G2')] },
      { id: 'gt2', members: [member('g2a', 'G3'), member('g2b', 'G4')] },
    ];
    await playersForTeams(groupTeams);
    const groups = {
      ...rr,
      id: crypto.randomUUID(),
      name: 'Grupos',
      teams: groupTeams,
      seedTeamIds: ['gt1', 'gt2'],
      stages: [
        {
          ...rr.stages[0],
          id: crypto.randomUUID(),
          type: 'groups',
          name: 'Grupos',
          seedTeamIds: ['gt1', 'gt2'],
          rounds: [
            {
              id: crypto.randomUUID(),
              number: 1,
              name: 'Grupo A',
              byes: [],
              matches: [
                {
                  id: crypto.randomUUID(),
                  sourceA: { type: 'team', teamId: 'gt1' },
                  sourceB: { type: 'team', teamId: 'gt2' },
                  teamAId: 'gt1',
                  teamBId: 'gt2',
                  lineupA: groupTeams[0].members,
                  lineupB: groupTeams[1].members,
                  scoreA: 21,
                  scoreB: 12,
                  playedDate: '2026-09-12',
                  winnerTeamId: 'gt1',
                },
              ],
            },
          ],
        },
      ],
    };
    const groupsImported = await importCompetition(db, andre, groups);
    expect(
      (await db.query('select type from public.competition_stages where competition_id = $1', [groupsImported.cloud_id]))
        .rows[0].type
    ).toBe('groups');

    const retry = await importCompetition(db, andre, rr);
    expect(retry.status).toBe('already_imported');
  });

  it('session importada aparece no perfil pessoal com sourceType session e originKey legado', async () => {
    const andrePlayer = guest('perf-andre', 'André');
    const others = [guest('perf-2', 'Ana'), guest('perf-3', 'Bruno'), guest('perf-4', 'Carla')];
    const map = await importPlayersOf(db, andre, [andrePlayer, ...others]);
    await asUser(db, andre, () => db.query('select public.link_player($1)', [map.get('perf-andre')]));
    const session = scoredSession({ id: 'sess-perf', players: [andrePlayer, ...others] });
    await importSession(db, andre, session);
    const personal = payloadOf(
      (await asUser(db, andre, () => db.query('select public.get_my_performance_matches() as payload'))).rows[0]
    );
    const mapped = mapCloudPerformanceMatches(personal.matches.filter((row) => row.session_id || row.legacy_source_id === 'sess-perf'));
    const match = mapped.find((item) => item.originKey === 'sess-perf');
    expect(match).toBeTruthy();
    expect(match.sourceType).toBe(MATCH_SOURCE_SESSION);
    expect(match.scoreA).toBe(21);
    expect(match.scoreB).toBe(18);
  });

  it('competition importada aparece na performance pessoal', async () => {
    const teams = [
      { id: 'pt1', members: [member('pp1', 'André'), member('pp2', 'Ana')] },
      { id: 'pt2', members: [member('pp3', 'Bruno'), member('pp4', 'Carla')] },
    ];
    const map = await importPlayersOf(
      db,
      paulo,
      teams.flatMap((team) => team.members.map((item) => guest(item.playerId, item.playerName)))
    );
    await asUser(db, paulo, () => db.query('select public.link_player($1)', [map.get('pp1')]));
    const draft = createDraftCompetition(
      { name: 'Perf comp', date: '2026-09-12', format: { teamSize: 2 } },
      { now: () => new Date(ISO) }
    );
    const ready = setDraftCompetitionTeams(draft, teams);
    const generated = generateCompetitionBracket(ready.competition, { seedTeamIds: ['pt1', 'pt2'] });
    expect(generated.ok).toBe(true);
    const played = applyCompetitionMatchResult(generated.competition, listCompetitionMatches(generated.competition)[0].id, {
      scoreA: 21,
      scoreB: 10,
      playedDate: '2026-09-12',
    });
    expect(played.ok).toBe(true);
    const imported = await importCompetition(db, paulo, played.competition);
    const personal = payloadOf(
      (await asUser(db, paulo, () => db.query('select public.get_my_performance_matches() as payload'))).rows[0]
    );
    const mapped = mapCloudPerformanceMatches(personal.matches);
    const match = mapped.find((item) => item.originKey === played.competition.id);
    expect(match?.sourceType).toBe(MATCH_SOURCE_COMPETITION);
    expect(imported.status).toBe('imported');
  });

  it('RLS: usuário B não lê batches/mappings de A; anon não importa; helpers sem EXECUTE', async () => {
    const batch = payloadOf(
      (await asUser(db, andre, () => db.query("select public.start_legacy_import_batch('gist', 'abc') as payload")))
        .rows[0]
    );
    await importPlayer(db, andre, guest('rls-player', 'Guest'));
    const seenByB = await asUser(db, paulo, () =>
      db.query('select id, user_id from public.legacy_import_batches')
    );
    expect(seenByB.rows.some((row) => row.id === batch)).toBe(false);
    const mapsB = await asUser(db, paulo, () =>
      db.query('select legacy_player_id from public.legacy_player_mappings')
    );
    expect(mapsB.rows.some((row) => row.legacy_player_id === 'rls-player')).toBe(false);
    expect(batch).toBeTruthy();

    await expect(asAnon(db, () => db.query("select public.start_legacy_import_batch('gist', 'x')"))).rejects.toThrow();

    const helpers = await db.query(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname in (
           'record_legacy_import_item',
           'require_mapped_player',
           'require_active_legacy_import_batch',
           'assert_legacy_import_owner',
           'mapped_player',
           'remap_competition_source'
         )`
    );
    expect(helpers.rows.length).toBeGreaterThan(0);
    expect(helpers.rows.every((row) => row.authenticated_exec === false && row.anon_exec === false)).toBe(true);

    const publicRpcs = await db.query(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('import_legacy_session', 'import_legacy_competition', 'import_legacy_player')`
    );
    expect(publicRpcs.rows.every((row) => row.authenticated_exec === true && row.anon_exec === false)).toBe(true);
  });

  it('paulo não altera sessão já importada pelo RPC de import', async () => {
    const players = [
      guest('own-1', 'A'),
      guest('own-2', 'B'),
      guest('own-3', 'C'),
      guest('own-4', 'D'),
    ];
    await importPlayersOf(db, andre, players);
    const session = scoredSession({ id: 'sess-owned', players });
    const imported = await importSession(db, andre, session);
    await expect(importSession(db, paulo, session)).rejects.toThrow(/LEGACY_ID_CONFLICT/);
    const row = (await db.query('select created_by, name, join_code from public.sessions where id = $1', [
      imported.cloud_id,
    ])).rows[0];
    expect(row.created_by).toBe(andre);
    expect(row.name).toBe('Encontro legado');

    await asUser(db, paulo, () => db.query('select public.join_session_by_code($1)', [row.join_code]));
    const membership = (
      await db.query('select role from public.session_members where session_id = $1 and user_id = $2', [
        imported.cloud_id,
        paulo,
      ])
    ).rows[0];
    expect(membership.role).toBe('member');
    await expectCode(() => importSession(db, paulo, session), 'LEGACY_ID_CONFLICT', [
      imported.cloud_id,
      row.join_code,
      'Encontro legado',
      andre,
    ]);
    const retry = await importSession(db, andre, session);
    expect(retry.status).toBe('already_imported');
    expect(retry.cloud_id).toBe(imported.cloud_id);
  });

  it('batch alheio, completed e cancelled são LEGACY_IMPORT_BATCH_INVALID genérico', async () => {
    const player = guest('batch-iso-a', 'Iso');
    const batchA = await startBatch(db, andre);
    const batchB = await startBatch(db, paulo);
    await expectCode(() => importPlayer(db, andre, player, null, batchB), 'LEGACY_IMPORT_BATCH_INVALID', [
      batchB,
      paulo,
    ]);
    await expectCode(
      () => importPlayer(db, andre, player, null, crypto.randomUUID()),
      'LEGACY_IMPORT_BATCH_INVALID'
    );

    const closed = await startBatch(db, andre);
    await finishBatch(db, andre, closed, 'completed');
    await expectCode(() => importPlayer(db, andre, player, null, closed), 'LEGACY_IMPORT_BATCH_INVALID', [closed]);

    const cancelled = await startBatch(db, andre);
    await finishBatch(db, andre, cancelled, 'cancelled');
    await expectCode(() => importPlayer(db, andre, player, null, cancelled), 'LEGACY_IMPORT_BATCH_INVALID');

    const imported = await importPlayer(db, andre, player, null, batchA);
    expect(imported.status).toBe('imported');
    const items = (
      await db.query(
        'select batch_id, user_id from public.legacy_import_items where legacy_id = $1 and batch_id = $2',
        [player.id, batchA]
      )
    ).rows;
    expect(items).toEqual([{ batch_id: batchA, user_id: andre }]);
  });

  it('member de competition importada não recebe already_imported', async () => {
    const draft = createDraftCompetition(
      { name: 'Comp conflito', date: '2026-09-12', format: { teamSize: 2 } },
      { now: () => new Date(ISO) }
    );
    const imported = await importCompetition(db, andre, draft);
    expect(imported.status).toBe('imported');
    await expectCode(() => importCompetition(db, paulo, draft), 'LEGACY_ID_CONFLICT', [
      imported.cloud_id,
      'Comp conflito',
      andre,
    ]);
    const code = (await db.query('select join_code from public.competitions where id = $1', [imported.cloud_id]))
      .rows[0].join_code;
    await asUser(db, paulo, () => db.query('select public.join_competition_by_code($1)', [code]));
    await expectCode(() => importCompetition(db, paulo, draft), 'LEGACY_ID_CONFLICT', [imported.cloud_id, code]);
    const retry = await importCompetition(db, andre, draft);
    expect(retry.status).toBe('already_imported');
    expect(retry.cloud_id).toBe(imported.cloud_id);
  });

  it('dois batches do mesmo usuário preservam itens; retry no mesmo batch não duplica; batch novo não duplica entidade', async () => {
    const players = [
      guest('hist-1', 'H1'),
      guest('hist-2', 'H2'),
      guest('hist-3', 'H3'),
      guest('hist-4', 'H4'),
    ];
    await importPlayersOf(db, andre, players);
    const session = scoredSession({ id: 'sess-hist-batch', players });
    const batch1 = await startBatch(db, andre);
    const first = await importSession(db, andre, session, batch1);
    expect(first.status).toBe('imported');
    const firstItem = (
      await db.query(
        `select id, status, cloud_id from public.legacy_import_items
         where batch_id = $1 and entity_type = 'session' and legacy_id = $2`,
        [batch1, session.id]
      )
    ).rows[0];
    expect(firstItem.status).toBe('imported');
    expect(firstItem.cloud_id).toBe(first.cloud_id);

    const sameBatch = await importSession(db, andre, session, batch1);
    expect(sameBatch.status).toBe('already_imported');
    expect(sameBatch.cloud_id).toBe(first.cloud_id);
    const retriedSame = (
      await db.query(
        `select id, status from public.legacy_import_items
         where batch_id = $1 and entity_type = 'session' and legacy_id = $2`,
        [batch1, session.id]
      )
    ).rows;
    expect(retriedSame).toHaveLength(1);
    expect(retriedSame[0].id).toBe(firstItem.id);
    expect(retriedSame[0].status).toBe('already_imported');
    await finishBatch(db, andre, batch1, 'completed');

    const batch2 = await startBatch(db, andre);
    const secondBatch = await importSession(db, andre, session, batch2);
    expect(secondBatch.status).toBe('already_imported');
    expect(secondBatch.cloud_id).toBe(first.cloud_id);
    const itemsBatch2 = (
      await db.query(
        `select id, status, cloud_id from public.legacy_import_items
         where batch_id = $1 and entity_type = 'session' and legacy_id = $2`,
        [batch2, session.id]
      )
    ).rows;
    expect(itemsBatch2).toHaveLength(1);
    expect(itemsBatch2[0].id).not.toBe(firstItem.id);
    expect(itemsBatch2[0].status).toBe('already_imported');
    expect(itemsBatch2[0].cloud_id).toBe(first.cloud_id);
    const firstBatchStill = (
      await db.query(
        `select id, status, cloud_id from public.legacy_import_items
         where batch_id = $1 and entity_type = 'session' and legacy_id = $2`,
        [batch1, session.id]
      )
    ).rows[0];
    expect(firstBatchStill.id).toBe(firstItem.id);
    expect(firstBatchStill.status).toBe('already_imported');
    expect(firstBatchStill.cloud_id).toBe(first.cloud_id);
    expect(
      (await db.query('select count(*)::int as n from public.sessions where legacy_source_id = $1', [session.id]))
        .rows[0].n
    ).toBe(1);
  });

  it('entidade importada aceita RPC normal; legacy_source_id não congela', async () => {
    const players = [
      guest('live-1', 'A'),
      guest('live-2', 'B'),
      guest('live-3', 'C'),
      guest('live-4', 'D'),
    ];
    await importPlayersOf(db, andre, players);
    const session = scoredSession({ id: 'sess-imported-live', status: 'in_progress', players });
    const imported = await importSession(db, andre, session);
    const before = (
      await db.query('select join_code, legacy_source_id, status from public.sessions where id = $1', [
        imported.cloud_id,
      ])
    ).rows[0];
    expect(before.legacy_source_id).toBe(session.id);
    const rotated = await asUser(db, andre, () =>
      db.query('select public.rotate_session_join_code($1) as code', [imported.cloud_id])
    );
    expect(rotated.rows[0].code).toBeTruthy();
    expect(rotated.rows[0].code).not.toBe(before.join_code);
    const after = (
      await db.query('select join_code, legacy_source_id, status from public.sessions where id = $1', [
        imported.cloud_id,
      ])
    ).rows[0];
    expect(after.legacy_source_id).toBe(session.id);
    expect(after.status).toBe('in_progress');

    const draft = createDraftCompetition(
      { name: 'Comp live', date: '2026-09-12', format: { teamSize: 2 } },
      { now: () => new Date(ISO) }
    );
    const importedComp = await importCompetition(db, andre, draft);
    const codeBefore = (
      await db.query('select join_code, legacy_source_id from public.competitions where id = $1', [
        importedComp.cloud_id,
      ])
    ).rows[0];
    const rotatedComp = await asUser(db, andre, () =>
      db.query('select public.rotate_competition_join_code($1) as code', [importedComp.cloud_id])
    );
    expect(rotatedComp.rows[0].code).not.toBe(codeBefore.join_code);
    expect(
      (await db.query('select legacy_source_id from public.competitions where id = $1', [importedComp.cloud_id]))
        .rows[0].legacy_source_id
    ).toBe(draft.id);
  });
});
