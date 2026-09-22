import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyCompetitionMatchResult,
  generateCompetitionBracket,
  listCompetitionMatches,
} from '../domain/competition.js';
import { MATCH_SOURCE_COMPETITION } from '../domain/performanceMatches.js';
import { mapCloudPerformanceMatches } from './cloudPerformance.js';
import { assembleCloudCompetition } from './competitionMappers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const preludeSql = readFileSync(join(root, 'supabase/tests/pglite_prelude.sql'), 'utf8');
const etapa1Sql = readFileSync(join(root, 'supabase/migrations/20260921120000_cloud_sessions.sql'), 'utf8');
const etapa2Sql = readFileSync(join(root, 'supabase/migrations/20260921140000_cloud_sessions_etapa2.sql'), 'utf8');
const etapa3Sql = readFileSync(
  join(root, 'supabase/migrations/20260921160000_player_identity_performance.sql'),
  'utf8'
);
const etapa4Sql = readFileSync(join(root, 'supabase/migrations/20260921180000_cloud_groups.sql'), 'utf8');
const etapa5Sql = readFileSync(join(root, 'supabase/migrations/20260921200000_group_performance.sql'), 'utf8');
const etapa6Sql = readFileSync(join(root, 'supabase/migrations/20260921220000_cloud_competitions.sql'), 'utf8');

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

function parsePayload(row) {
  const payload = row.payload ?? row.get_my_performance_matches ?? row.get_group_performance_matches;
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

async function structureVersion(db, competitionId) {
  return Number(
    (await db.query('select structure_version from public.competitions where id = $1', [competitionId])).rows[0]
      .structure_version
  );
}

async function loadAssembled(db, competitionId, myUserId) {
  const competition = (await db.query('select * from public.competitions where id = $1', [competitionId])).rows[0];
  const members = (
    await db.query('select competition_id, user_id, role from public.competition_members where competition_id = $1', [
      competitionId,
    ])
  ).rows;
  const players = (
    await db.query(
      'select competition_id, player_id, player_name_snapshot, sort_index from public.competition_players where competition_id = $1',
      [competitionId]
    )
  ).rows;
  const teams = (
    await db.query('select id, competition_id, sort_index from public.competition_teams where competition_id = $1', [
      competitionId,
    ])
  ).rows;
  const teamMembers = (
    await db.query(
      'select team_id, competition_id, player_id, player_name_snapshot, sort_index from public.competition_team_members where competition_id = $1',
      [competitionId]
    )
  ).rows;
  const stages = (
    await db.query('select * from public.competition_stages where competition_id = $1 order by number', [competitionId])
  ).rows;
  const rounds = (await db.query('select * from public.competition_rounds where competition_id = $1', [competitionId]))
    .rows;
  const byes = (await db.query('select * from public.competition_round_byes where competition_id = $1', [competitionId]))
    .rows;
  const matches = (await db.query('select * from public.competition_matches where competition_id = $1', [competitionId]))
    .rows;
  const matchPlayers = (
    await db.query(
      'select match_id, competition_id, player_id, player_name_snapshot, side, sort_index from public.competition_match_players where competition_id = $1',
      [competitionId]
    )
  ).rows;
  const events = (
    await db.query('select * from public.competition_match_events where competition_id = $1', [competitionId])
  ).rows;
  return assembleCloudCompetition({
    competition,
    members,
    players,
    teams,
    teamMembers,
    stages,
    rounds,
    byes,
    matches,
    matchPlayers,
    events,
    myUserId,
  });
}

async function insertPlayer(db, ownerId, name) {
  return (
    await asUser(db, ownerId, () =>
      db.query(
        `insert into public.players (name, created_by, skill_score, gender, height)
         values ($1, $2, 3, 'M', 'short')
         returning id, name`,
        [name, ownerId]
      )
    )
  ).rows[0];
}

function cloneCompetitionDoc(competition) {
  return JSON.parse(JSON.stringify(competition));
}

async function createReadyCompetition(db, { ownerId, memberId, name, teamCount }) {
  const created = await asUser(db, ownerId, () =>
    db.query('select * from public.create_competition($1, $2, $3, $4, $5::jsonb)', [
      name,
      '2026-09-21',
      2,
      null,
      JSON.stringify([{ type: 'single_elimination', config: {} }]),
    ])
  );
  const competitionId = created.rows[0].id;
  const joinCode = (
    await asUser(db, ownerId, () => db.query('select join_code from public.competitions where id = $1', [competitionId]))
  ).rows[0].join_code;
  await asUser(db, memberId, () => db.query('select public.join_competition_by_code($1)', [joinCode]));

  const teams = [];
  for (let index = 0; index < teamCount; index += 1) {
    const first = await insertPlayer(db, ownerId, `${name}-p${index}a`);
    const second = await insertPlayer(db, ownerId, `${name}-p${index}b`);
    teams.push({
      id: crypto.randomUUID(),
      members: [
        { playerId: first.id, playerName: first.name },
        { playerId: second.id, playerName: second.name },
      ],
    });
  }

  const version = await structureVersion(db, competitionId);
  await asUser(db, ownerId, () =>
    db.query('select public.replace_competition_teams($1, $2, $3::jsonb)', [
      competitionId,
      version,
      JSON.stringify(teams),
    ])
  );
  const afterTeams = await structureVersion(db, competitionId);
  const drafted = await loadAssembled(db, competitionId, ownerId);
  const generated = generateCompetitionBracket(drafted.competition, {
    seedTeamIds: drafted.competition.teams.map((team) => team.id),
  });
  if (!generated.ok) {
    throw new Error(generated.errors?.[0]?.message || 'generate failed');
  }
  await asUser(db, ownerId, () =>
    db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
      competitionId,
      afterTeams,
      JSON.stringify(generated.competition),
    ])
  );
  return loadAssembled(db, competitionId, ownerId);
}

function applyScoreDoc(competition, matchId, scoreA, scoreB, playedDate = '2026-09-21') {
  const played = applyCompetitionMatchResult(competition, matchId, { scoreA, scoreB, playedDate });
  expect(played.ok).toBe(true);
  return played.competition;
}

async function setScore(db, userId, assembled, matchId, scoreA, scoreB, playedDate, document) {
  return asUser(db, userId, () =>
    db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
      assembled.competition.id,
      matchId,
      scoreA,
      scoreB,
      playedDate,
      assembled.matchVersions[matchId],
      assembled.structureVersion,
      JSON.stringify(document),
    ])
  );
}

describe('cloud competitions', () => {
  let db;
  let andre;
  let paulo;
  let davi;
  let outsider;
  let groupId;
  let otherGroupId;
  let standaloneId;
  let groupCompId;
  let otherCompId;
  let playerAndre;
  let playerPaulo;
  let playerGuest;
  let matchId;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(preludeSql);
    await db.exec(etapa1Sql);
    await db.exec(etapa2Sql);
    await db.exec(etapa3Sql);
    await db.exec(etapa4Sql);
    await db.exec(etapa5Sql);
    await db.exec(etapa6Sql);

    andre = crypto.randomUUID();
    paulo = crypto.randomUUID();
    davi = crypto.randomUUID();
    outsider = crypto.randomUUID();

    await insertUser(db, andre, 'andre@test.com', 'André');
    await insertUser(db, paulo, 'paulo@test.com', 'Paulo');
    await insertUser(db, davi, 'davi@test.com', 'Davi');
    await insertUser(db, outsider, 'outsider@test.com', 'De fora');

    groupId = (await asUser(db, andre, () => db.query('select * from public.create_group($1, $2)', ['Vôlei Quinta', null])))
      .rows[0].id;
    const groupJoinCode = (await asUser(db, andre, () =>
      db.query('select join_code from public.groups where id = $1', [groupId])
    )).rows[0].join_code;
    await asUser(db, paulo, () => db.query('select public.join_group_by_code($1)', [groupJoinCode]));
    await asUser(db, davi, () => db.query('select public.join_group_by_code($1)', [groupJoinCode]));
    otherGroupId = (await asUser(db, andre, () => db.query('select * from public.create_group($1, $2)', ['Outra', null])))
      .rows[0].id;

    standaloneId = (
      await asUser(db, andre, () =>
        db.query('select * from public.create_competition($1, $2, $3, $4, $5::jsonb)', [
          'Avulsa',
          '2026-09-21',
          2,
          null,
          JSON.stringify([{ type: 'single_elimination', config: {} }]),
        ])
      )
    ).rows[0].id;

    groupCompId = (
      await asUser(db, andre, () =>
        db.query('select * from public.create_competition($1, $2, $3, $4, $5::jsonb)', [
          'Do grupo',
          '2026-09-21',
          2,
          groupId,
          JSON.stringify([{ type: 'single_elimination', config: {} }]),
        ])
      )
    ).rows[0].id;

    otherCompId = (
      await asUser(db, andre, () =>
        db.query('select * from public.create_competition($1, $2, $3, $4, $5::jsonb)', [
          'Outro grupo',
          '2026-09-21',
          2,
          otherGroupId,
          JSON.stringify([{ type: 'single_elimination', config: {} }]),
        ])
      )
    ).rows[0].id;

    playerAndre = (await asUser(db, andre, () => db.query("select * from public.create_and_link_player('André')")))
      .rows[0];
    playerPaulo = (await asUser(db, paulo, () => db.query("select * from public.create_and_link_player('Paulo')")))
      .rows[0];
    playerGuest = await insertPlayer(db, andre, 'Convidado');
    const playerFourth = await insertPlayer(db, andre, 'DaviP');

    const groupCode = (
      await asUser(db, andre, () => db.query('select join_code from public.competitions where id = $1', [groupCompId]))
    ).rows[0].join_code;
    await asUser(db, paulo, () => db.query('select public.join_competition_by_code($1)', [groupCode]));

    const teamA = crypto.randomUUID();
    const teamB = crypto.randomUUID();
    const version = await structureVersion(db, groupCompId);
    await asUser(db, andre, () =>
      db.query('select public.replace_competition_teams($1, $2, $3::jsonb)', [
        groupCompId,
        version,
        JSON.stringify([
          {
            id: teamA,
            members: [
              { playerId: playerAndre.id, playerName: 'André' },
              { playerId: playerGuest.id, playerName: 'Convidado' },
            ],
          },
          {
            id: teamB,
            members: [
              { playerId: playerPaulo.id, playerName: 'Paulo' },
              { playerId: playerFourth.id, playerName: 'DaviP' },
            ],
          },
        ]),
      ])
    );

    const afterTeams = await structureVersion(db, groupCompId);
    const drafted = await loadAssembled(db, groupCompId, andre);
    const generated = generateCompetitionBracket(drafted.competition, {
      seedTeamIds: drafted.competition.teams.map((team) => team.id),
    });
    if (!generated.ok) {
      throw new Error(generated.errors?.[0]?.message || 'generate failed in beforeAll');
    }
    await asUser(db, andre, () =>
      db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
        groupCompId,
        afterTeams,
        JSON.stringify(generated.competition),
      ])
    );
    const live = await loadAssembled(db, groupCompId, andre);
    matchId = listCompetitionMatches(live.competition)[0]?.id;
  }, 120000);

  afterAll(async () => {
    await db?.close?.();
  });

  it('cria competição avulsa e o criador vira owner; não copia group_members', async () => {
    const row = await asUser(db, andre, () =>
      db.query('select group_id, created_by, status from public.competitions where id = $1', [standaloneId])
    );
    expect(row.rows[0].group_id).toBeNull();
    expect(row.rows[0].created_by).toBe(andre);
    const members = await asUser(db, andre, () =>
      db.query('select user_id, role from public.competition_members where competition_id = $1', [standaloneId])
    );
    expect(members.rows).toEqual([{ user_id: andre, role: 'owner' }]);
  });

  it('cria competição no grupo sendo membro; outsider não cria; group_members não viram competition_members', async () => {
    const members = await asUser(db, andre, () =>
      db.query('select user_id, role from public.competition_members where competition_id = $1 order by role, user_id', [
        groupCompId,
      ])
    );
    expect(members.rows.map((row) => row.user_id).sort()).toEqual([andre, paulo].sort());
    expect(members.rows.some((row) => row.user_id === davi)).toBe(false);
    expect(members.rows.find((row) => row.user_id === andre).role).toBe('owner');
    await expect(
      asUser(db, outsider, () =>
        db.query('select * from public.create_competition($1, $2, $3, $4, $5::jsonb)', [
          'Hack',
          '2026-09-21',
          2,
          groupId,
          JSON.stringify([{ type: 'single_elimination', config: {} }]),
        ])
      )
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
  });

  it('join por código cria member, não cria competition_player nem group_member', async () => {
    const code = (await db.query('select join_code from public.competitions where id = $1', [standaloneId])).rows[0]
      .join_code;
    const joined = await asUser(db, outsider, () =>
      db.query('select public.join_competition_by_code($1) as id', [code.toLowerCase()])
    );
    expect(joined.rows[0].id).toBe(standaloneId);
    const role = await asUser(db, outsider, () =>
      db.query('select role from public.competition_members where competition_id = $1 and user_id = $2', [
        standaloneId,
        outsider,
      ])
    );
    expect(role.rows[0].role).toBe('member');
    const players = await db.query(
      'select count(*)::int as n from public.competition_players where competition_id = $1',
      [standaloneId]
    );
    expect(players.rows[0].n).toBe(0);
    const extraGroup = await db.query('select 1 from public.group_members where user_id = $1', [outsider]);
    expect(extraGroup.rows).toHaveLength(0);
  });

  it('outsider não lê a competição', async () => {
    const rows = await asUser(db, outsider, () =>
      db.query('select id from public.competitions where id = $1', [groupCompId])
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('member não altera estrutura; owner já gerou a chave com o domínio JS', async () => {
    const loaded = await loadAssembled(db, groupCompId, andre);
    expect(loaded.competition.status).toBe('in_progress');
    expect(listCompetitionMatches(loaded.competition).length).toBeGreaterThan(0);
    const version = await structureVersion(db, groupCompId);
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
          groupCompId,
          version,
          JSON.stringify(loaded.competition),
        ])
      )
    ).rejects.toThrow(/COMPETITION_FORBIDDEN/);
    expect(matchId).toBeTruthy();
  });

  it('structure version conflict não sobrescreve', async () => {
    const loaded = await loadAssembled(db, groupCompId, andre);
    await expect(
      asUser(db, andre, () =>
        db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
          groupCompId,
          0,
          JSON.stringify(loaded.competition),
        ])
      )
    ).rejects.toThrow(/COMPETITION_STRUCTURE_VERSION_CONFLICT/);
  });

  it('member registra placar; viewer não; score conflict não gera event falso', async () => {
    const daviCode = (
      await asUser(db, andre, () => db.query('select join_code from public.competitions where id = $1', [groupCompId]))
    ).rows[0].join_code;
    await asUser(db, davi, () => db.query('select public.join_competition_by_code($1)', [daviCode]));
    await asUser(db, andre, () =>
      db.query('select public.set_competition_member_role($1, $2, $3)', [groupCompId, davi, 'viewer'])
    );

    const loaded = await loadAssembled(db, groupCompId, paulo);
    const currentMatchId = listCompetitionMatches(loaded.competition)[0]?.id ?? matchId;
    matchId = currentMatchId;
    const played = applyCompetitionMatchResult(loaded.competition, currentMatchId, {
      scoreA: 21,
      scoreB: 18,
      playedDate: '2026-09-21',
    });
    expect(played.errors ?? []).toEqual([]);
    expect(played.ok).toBe(true);
    const version = Number(loaded.matchVersions[currentMatchId] ?? 0);
    const structureVersionNow = await structureVersion(db, groupCompId);

    await expect(
      asUser(db, davi, () =>
        db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
          groupCompId,
          currentMatchId,
          21,
          18,
          '2026-09-21',
          version,
          structureVersionNow,
          JSON.stringify(played.competition),
        ])
      )
    ).rejects.toThrow(/SCORE_FORBIDDEN/);

    await asUser(db, paulo, () =>
      db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
        groupCompId,
        currentMatchId,
        21,
        18,
        '2026-09-21',
        version,
        structureVersionNow,
        JSON.stringify(played.competition),
      ])
    );

    const events = await db.query(
      'select count(*)::int as n from public.competition_match_events where match_id = $1',
      [matchId]
    );
    expect(events.rows[0].n).toBe(1);

    const afterVersion = Number(
      (await db.query('select version from public.competition_matches where id = $1', [matchId])).rows[0].version
    );
    const later = applyCompetitionMatchResult(played.competition, matchId, {
      scoreA: 21,
      scoreB: 19,
      playedDate: '2026-09-21',
    });
    const staleStructureVersion = await structureVersion(db, groupCompId);
    await expect(
      asUser(db, paulo, () =>
        db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
          groupCompId,
          matchId,
          21,
          19,
          '2026-09-21',
          version,
          staleStructureVersion,
          JSON.stringify(later.ok ? later.competition : played.competition),
        ])
      )
    ).rejects.toThrow(/SCORE_VERSION_CONFLICT/);
    const eventsAfter = await db.query(
      'select count(*)::int as n from public.competition_match_events where match_id = $1',
      [matchId]
    );
    expect(eventsAfter.rows[0].n).toBe(1);
    expect(afterVersion).toBe(version + 1);
  });

  it('player fora do roster não entra na partida; unique do elenco', async () => {
    const stray = await insertPlayer(db, andre, 'Fora');
    await expect(
      asUser(db, andre, () =>
        db.query(
          `insert into public.competition_match_players (match_id, competition_id, player_id, side, sort_index, player_name_snapshot)
           values ($1, $2, $3, 'a', 9, 'Fora')`,
          [matchId, groupCompId, stray.id]
        )
      )
    ).rejects.toThrow();
  });

  it('finalize: member não; owner sim; estrutura imutável depois; admin corrige placar', async () => {
    const version = await structureVersion(db, groupCompId);
    await expect(
      asUser(db, paulo, () => db.query('select * from public.finalize_competition($1, $2)', [groupCompId, version]))
    ).rejects.toThrow(/COMPETITION_FORBIDDEN/);

    const finalized = await asUser(db, andre, () =>
      db.query('select * from public.finalize_competition($1, $2)', [groupCompId, version])
    );
    const persisted = (
      await db.query('select status, structure_version from public.competitions where id = $1', [groupCompId])
    ).rows[0];
    expect(persisted.status).toBe('finished');
    expect(Number(finalized.rows[0].structure_version)).toBe(Number(persisted.structure_version));
    expect(Number(finalized.rows[0].structure_version)).toBe(version + 1);

    const loaded = await loadAssembled(db, groupCompId, andre);
    const finishedVersion = await structureVersion(db, groupCompId);
    await expect(
      asUser(db, andre, () =>
        db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
          groupCompId,
          finishedVersion,
          JSON.stringify(loaded.competition),
        ])
      )
    ).rejects.toThrow(/COMPETITION_FINISHED/);

    const matchVersion = Number(
      (await db.query('select version from public.competition_matches where id = $1', [matchId])).rows[0].version
    );
    const corrected = applyCompetitionMatchResult(loaded.competition, matchId, {
      scoreA: 21,
      scoreB: 15,
      playedDate: '2026-09-21',
    });
    await expect(
      asUser(db, paulo, () =>
        db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
          groupCompId,
          matchId,
          21,
          15,
          '2026-09-21',
          matchVersion,
          finishedVersion,
          JSON.stringify(corrected.competition),
        ])
      )
    ).rejects.toThrow(/SCORE_FORBIDDEN/);

    await asUser(db, andre, () =>
      db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
        groupCompId,
        matchId,
        21,
        15,
        '2026-09-21',
        matchVersion,
        finishedVersion,
        JSON.stringify(corrected.competition),
      ])
    );
  });

  it('performance pessoal inclui competition; grupo inclui só a do grupo; avulsa e outro grupo ficam de fora', async () => {
    const personal = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_my_performance_matches() as payload'))).rows[0]
    );
    expect(personal.matches.some((match) => match.competition_id === groupCompId)).toBe(true);
    const mapped = mapCloudPerformanceMatches(personal.matches.filter((match) => match.competition_id === groupCompId));
    expect(mapped[0].sourceType).toBe(MATCH_SOURCE_COMPETITION);
    expect(mapped[0].originKey).toBe(groupCompId);

    const group = parsePayload(
      (await asUser(db, andre, () =>
        db.query('select public.get_group_performance_matches($1) as payload', [groupId])
      )).rows[0]
    );
    const competitionIds = group.matches.map((match) => match.competition_id).filter(Boolean);
    expect(competitionIds).toContain(groupCompId);
    expect(competitionIds).not.toContain(standaloneId);
    expect(competitionIds).not.toContain(otherCompId);
    expect(group.members.some((member) => member.player_id === playerGuest.id)).toBe(false);
    const raw = JSON.stringify(group);
    expect(raw).not.toMatch(/join_code/);
    expect(raw).not.toMatch(/andre@test\.com/);
    expect(group.matches[0]).not.toHaveProperty('sourceType');
  });

  it('convidado no elenco não vira group_member; anon não executa create', async () => {
    const guestMember = await db.query(
      'select 1 from public.group_members gm join public.players p on p.linked_user_id = gm.user_id where p.id = $1',
      [playerGuest.id]
    );
    expect(guestMember.rows).toHaveLength(0);
    await expect(
      asAnon(db, () =>
        db.query('select * from public.create_competition($1, $2, $3, $4, $5::jsonb)', [
          'Anon',
          '2026-09-21',
          2,
          null,
          JSON.stringify([{ type: 'single_elimination', config: {} }]),
        ])
      )
    ).rejects.toThrow();
  });

  describe('score RPC hardening', () => {
    let bracket;
    let finalizable;
    let openerId;
    let otherMatchId;
    let groupMateA;
    let groupMateB;

    beforeAll(async () => {
      bracket = await createReadyCompetition(db, {
        ownerId: andre,
        memberId: paulo,
        name: 'Chave 4',
        teamCount: 4,
      });
      finalizable = await createReadyCompetition(db, {
        ownerId: andre,
        memberId: paulo,
        name: 'Finalizável',
        teamCount: 2,
      });
      const firstRound = (bracket.competition.stages[0].rounds ?? []).find((round) => round.number === 1);
      openerId = firstRound.matches[0].id;
      otherMatchId = listCompetitionMatches(bracket.competition).find((match) => match.id !== openerId).id;

      groupMateA = crypto.randomUUID();
      groupMateB = crypto.randomUUID();
      await insertUser(db, groupMateA, 'gabe@test.com', 'Gabe');
      await insertUser(db, groupMateB, 'rita@test.com', 'Rita');
      const groupOnly = await asUser(db, groupMateA, () =>
        db.query('select * from public.create_group($1, $2)', ['Só grupo', null])
      );
      const groupOnlyCode = groupOnly.rows[0].join_code;
      await asUser(db, groupMateB, () => db.query('select public.join_group_by_code($1)', [groupOnlyCode]));
    }, 120000);

    it('member não altera stage/round/match/source/outro placar via score RPC', async () => {
      const stageChanged = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      stageChanged.stages[0].type = 'round_robin';
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', stageChanged)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const addRound = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      addRound.stages[0].rounds.push({
        id: crypto.randomUUID(),
        number: 9,
        name: 'Invasão',
        bracket: 'winners',
        matches: [],
        byes: [],
      });
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', addRound)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const removeRound = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      removeRound.stages[0].rounds = removeRound.stages[0].rounds.slice(0, -1);
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', removeRound)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const addMatch = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      addMatch.stages[0].rounds[0].matches.push({
        id: crypto.randomUUID(),
        roundId: addMatch.stages[0].rounds[0].id,
        sourceA: { type: 'seed', seed: 1 },
        sourceB: { type: 'seed', seed: 2 },
        teamAId: null,
        teamBId: null,
        lineupA: [],
        lineupB: [],
        scoreA: null,
        scoreB: null,
        playedDate: null,
        winnerTeamId: null,
      });
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', addMatch)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const removeMatch = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      const roundWithOpener = removeMatch.stages[0].rounds.find((round) =>
        (round.matches ?? []).some((match) => match.id === openerId)
      );
      roundWithOpener.matches = roundWithOpener.matches.filter((match) => match.id !== openerId);
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', removeMatch)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const sourceChanged = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      const opener = listCompetitionMatches(sourceChanged).find((match) => match.id === openerId);
      opener.sourceA = { type: 'team', teamId: sourceChanged.teams[0].id };
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', sourceChanged)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const otherScore = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      const other = listCompetitionMatches(otherScore).find((match) => match.id === otherMatchId);
      other.scoreA = 21;
      other.scoreB = 10;
      other.playedDate = '2026-09-21';
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', otherScore)).rejects.toThrow(
        /INVALID_PLAN/
      );
    });

    it('p_document com score ou playedDate diferente dos parâmetros falha', async () => {
      const played = applyScoreDoc(bracket.competition, openerId, 21, 18, '2026-09-21');
      await expect(setScore(db, paulo, bracket, openerId, 21, 19, '2026-09-21', played)).rejects.toThrow(/INVALID_PLAN/);
      await expect(setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-22', played)).rejects.toThrow(/INVALID_PLAN/);
    });

    it('score válido propaga times do bracket; status finished no documento é ignorado; stale não gera audit', async () => {
      const played = cloneCompetitionDoc(applyScoreDoc(bracket.competition, openerId, 21, 18));
      played.status = 'finished';
      const winnerId = listCompetitionMatches(played).find((match) => match.id === openerId).winnerTeamId;
      await setScore(db, paulo, bracket, openerId, 21, 18, '2026-09-21', played);

      const loaded = await loadAssembled(db, bracket.competition.id, paulo);
      const downstream = listCompetitionMatches(loaded.competition).filter((match) => match.id !== openerId);
      expect(downstream.some((match) => match.teamAId === winnerId || match.teamBId === winnerId)).toBe(true);
      expect(downstream.every((match) => match.scoreA == null && match.scoreB == null)).toBe(true);
      expect(loaded.competition.status).toBe('in_progress');

      const eventsBefore = (
        await db.query('select count(*)::int as n from public.competition_match_events where match_id = $1', [openerId])
      ).rows[0].n;

      const later = applyScoreDoc(loaded.competition, openerId, 21, 19);
      await expect(
        asUser(db, paulo, () =>
          db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
            loaded.competition.id,
            openerId,
            21,
            19,
            '2026-09-21',
            bracket.matchVersions[openerId],
            loaded.structureVersion,
            JSON.stringify(later),
          ])
        )
      ).rejects.toThrow(/SCORE_VERSION_CONFLICT/);

      const eventsAfter = (
        await db.query('select count(*)::int as n from public.competition_match_events where match_id = $1', [openerId])
      ).rows[0].n;
      expect(eventsAfter).toBe(eventsBefore);
    });

    it('save_competition_structure não aceita finished nem regressão in_progress -> draft', async () => {
      const loaded = await loadAssembled(db, bracket.competition.id, andre);
      const finished = cloneCompetitionDoc(loaded.competition);
      finished.status = 'finished';
      await expect(
        asUser(db, andre, () =>
          db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
            loaded.competition.id,
            loaded.structureVersion,
            JSON.stringify(finished),
          ])
        )
      ).rejects.toThrow(/COMPETITION_STATUS_FORBIDDEN/);

      const drafted = cloneCompetitionDoc(loaded.competition);
      drafted.status = 'draft';
      await expect(
        asUser(db, andre, () =>
          db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
            loaded.competition.id,
            loaded.structureVersion,
            JSON.stringify(drafted),
          ])
        )
      ).rejects.toThrow(/COMPETITION_STATUS_FORBIDDEN/);
    });

    it('finalize_competition retorna o structure_version persistido', async () => {
      const matchId = listCompetitionMatches(finalizable.competition)[0].id;
      const played = applyScoreDoc(finalizable.competition, matchId, 21, 15);
      await setScore(db, paulo, finalizable, matchId, 21, 15, '2026-09-21', played);
      const version = await structureVersion(db, finalizable.competition.id);
      const returned = await asUser(db, andre, () =>
        db.query('select * from public.finalize_competition($1, $2)', [finalizable.competition.id, version])
      );
      const persisted = (
        await db.query('select status, structure_version from public.competitions where id = $1', [
          finalizable.competition.id,
        ])
      ).rows[0];
      expect(persisted.status).toBe('finished');
      expect(Number(returned.rows[0].structure_version)).toBe(Number(persisted.structure_version));
      expect(Number(returned.rows[0].structure_version)).toBe(version + 1);
    });

    it('profiles de quem só compartilha grupo continuam visíveis', async () => {
      const names = await asUser(db, groupMateA, () =>
        db.query('select display_name from public.profiles order by display_name')
      );
      expect(names.rows.map((row) => row.display_name)).toEqual(['Gabe', 'Rita']);
      const other = await asUser(db, groupMateB, () =>
        db.query('select display_name from public.profiles order by display_name')
      );
      expect(other.rows.map((row) => row.display_name)).toEqual(['Gabe', 'Rita']);
    });

    it('helpers privados sensíveis não têm EXECUTE para authenticated/anon/public', async () => {
      const rows = (
        await db.query(
          `select p.proname,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
                  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                  has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private'
             and p.proname in (
               'lock_competition_structure',
               'bump_competition_structure_version',
               'ensure_competition_player',
               'replace_competition_graph',
               'apply_competition_score_document',
               'competition_role',
               'can_manage_competition',
               'json_text',
               'json_int'
             )
           order by p.proname`
        )
      ).rows;
      expect(rows.length).toBeGreaterThanOrEqual(8);
      for (const row of rows) {
        expect(row.authenticated_exec).toBe(false);
        expect(row.anon_exec).toBe(false);
        expect(row.public_exec).toBe(false);
      }

      const rlsHelpers = (
        await db.query(
          `select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private'
             and p.proname in ('is_competition_member', 'shares_competition_with', 'shares_group_with')
           order by p.proname`
        )
      ).rows;
      expect(rlsHelpers.every((row) => row.authenticated_exec === true)).toBe(true);

      await expect(
        asUser(db, paulo, () =>
          db.query('select private.lock_competition_structure($1, $2)', [bracket.competition.id, 0])
        )
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('score history and structure versions', () => {
    let history;
    let openerId;
    let otherFirstId;
    let futureId;

    beforeAll(async () => {
      history = await createReadyCompetition(db, {
        ownerId: andre,
        memberId: paulo,
        name: 'Histórico',
        teamCount: 4,
      });
      const firstRound = (history.competition.stages[0].rounds ?? []).find((round) => round.number === 1);
      openerId = firstRound.matches[0].id;
      otherFirstId = firstRound.matches[1].id;
      futureId = listCompetitionMatches(history.competition).find(
        (match) => match.id !== openerId && match.id !== otherFirstId
      ).id;
    }, 120000);

    function outsiderMember(competition, match) {
      const used = new Set(
        [...(match.lineupA ?? []), ...(match.lineupB ?? [])].map((member) => member.playerId)
      );
      for (const team of competition.teams) {
        for (const member of team.members) {
          if (!used.has(member.playerId)) return member;
        }
      }
      return null;
    }

    it('member não reescreve lineup/times/winner/nomes de partidas jogadas ou futuras', async () => {
      const targetSwap = cloneCompetitionDoc(applyScoreDoc(history.competition, openerId, 21, 18));
      const opener = listCompetitionMatches(targetSwap).find((match) => match.id === openerId);
      const stolen = outsiderMember(targetSwap, opener);
      opener.lineupA = [{ playerId: stolen.playerId, playerName: stolen.playerName }, ...opener.lineupA.slice(1)];
      await expect(setScore(db, paulo, history, openerId, 21, 18, '2026-09-21', targetSwap)).rejects.toThrow(
        /COMPETITION_MATCH_HISTORY_LOCKED/
      );

      const futureWinner = cloneCompetitionDoc(applyScoreDoc(history.competition, openerId, 21, 18));
      const future = listCompetitionMatches(futureWinner).find((match) => match.id === futureId);
      future.winnerTeamId = futureWinner.teams[0].id;
      await expect(setScore(db, paulo, history, openerId, 21, 18, '2026-09-21', futureWinner)).rejects.toThrow(
        /COMPETITION_MATCH_HISTORY_LOCKED/
      );

      const futureLineup = cloneCompetitionDoc(applyScoreDoc(history.competition, openerId, 21, 18));
      const next = listCompetitionMatches(futureLineup).find((match) => match.id === futureId);
      next.teamAId = futureLineup.teams[0].id;
      next.lineupA = [
        {
          playerId: futureLineup.teams[1].members[0].playerId,
          playerName: 'Invasor',
        },
      ];
      await expect(setScore(db, paulo, history, openerId, 21, 18, '2026-09-21', futureLineup)).rejects.toThrow(
        /INVALID_PLAN/
      );

      const played = applyScoreDoc(history.competition, openerId, 21, 18);
      await setScore(db, paulo, history, openerId, 21, 18, '2026-09-21', played);
      history = await loadAssembled(db, history.competition.id, paulo);

      const persistedFuture = listCompetitionMatches(history.competition).find((match) => match.id === futureId);
      expect(persistedFuture.winnerTeamId).toBeNull();
      expect(persistedFuture.scoreA).toBeNull();
      if (persistedFuture.teamAId) {
        const team = history.competition.teams.find((item) => item.id === persistedFuture.teamAId);
        expect((persistedFuture.lineupA ?? []).map((member) => member.playerId).sort()).toEqual(
          (team.members ?? []).map((member) => member.playerId).sort()
        );
        expect((persistedFuture.lineupA ?? []).every((member) => member.playerName !== 'HackName')).toBe(true);
      }

      const fakeNames = cloneCompetitionDoc(applyScoreDoc(history.competition, otherFirstId, 21, 12));
      const futureNamed = listCompetitionMatches(fakeNames).find((match) => match.id === futureId);
      futureNamed.lineupA = (futureNamed.lineupA ?? []).map((member) => ({
        ...member,
        playerName: 'HackName',
      }));
      await setScore(db, paulo, history, otherFirstId, 21, 12, '2026-09-21', fakeNames);
      const afterNames = await loadAssembled(db, history.competition.id, paulo);
      const storedFuture = listCompetitionMatches(afterNames.competition).find((match) => match.id === futureId);
      const snapshots = (
        await db.query(
          'select player_name_snapshot from public.competition_match_players where match_id = $1',
          [futureId]
        )
      ).rows.map((row) => row.player_name_snapshot);
      expect(snapshots.every((name) => name !== 'HackName')).toBe(true);
      expect(storedFuture.winnerTeamId).toBeNull();

      history = afterNames;
      const replayed = cloneCompetitionDoc(applyScoreDoc(history.competition, otherFirstId, 21, 10));
      const scoredOpener = listCompetitionMatches(replayed).find((match) => match.id === openerId);
      const thief = outsiderMember(replayed, scoredOpener);
      scoredOpener.lineupA = [
        { playerId: thief.playerId, playerName: thief.playerName },
        ...scoredOpener.lineupA.slice(1),
      ];
      await expect(setScore(db, paulo, history, otherFirstId, 21, 10, '2026-09-21', replayed)).rejects.toThrow(
        /COMPETITION_MATCH_HISTORY_LOCKED/
      );

      const teamSwap = cloneCompetitionDoc(applyScoreDoc(history.competition, otherFirstId, 21, 10));
      const scored = listCompetitionMatches(teamSwap).find((match) => match.id === openerId);
      scored.teamAId = teamSwap.teams.find((team) => team.id !== scored.teamAId).id;
      await expect(setScore(db, paulo, history, otherFirstId, 21, 10, '2026-09-21', teamSwap)).rejects.toThrow(
        /COMPETITION_MATCH_HISTORY_LOCKED/
      );

      const winnerSwap = cloneCompetitionDoc(applyScoreDoc(history.competition, otherFirstId, 21, 10));
      const otherWinner = listCompetitionMatches(winnerSwap).find((match) => match.id === openerId);
      otherWinner.winnerTeamId = otherWinner.teamAId === otherWinner.winnerTeamId
        ? otherWinner.teamBId
        : otherWinner.teamAId;
      await expect(setScore(db, paulo, history, otherFirstId, 21, 10, '2026-09-21', winnerSwap)).rejects.toThrow(
        /COMPETITION_MATCH_HISTORY_LOCKED/
      );
    });

    it('save_competition_structure preserva version/score/audit e recusa placar ou remoção pontuada', async () => {
      const loaded = await loadAssembled(db, history.competition.id, andre);
      const scored = listCompetitionMatches(loaded.competition).find((match) => match.id === openerId);
      expect(Number(loaded.matchVersions[openerId])).toBe(1);
      expect(scored.scoreA).toBe(21);
      expect(scored.scoreB).toBe(18);
      const eventsBefore = (
        await db.query(
          'select match_version_before, match_version_after from public.competition_match_events where match_id = $1',
          [openerId]
        )
      ).rows;
      expect(eventsBefore[0].match_version_after).toBe(1);

      const withRound = cloneCompetitionDoc(loaded.competition);
      const newMatchId = crypto.randomUUID();
      withRound.stages[0].rounds.push({
        id: crypto.randomUUID(),
        number: 9,
        name: 'Extra',
        bracket: 'winners',
        byes: [],
        matches: [
          {
            id: newMatchId,
            roundId: null,
            sourceA: { type: 'seed', seed: 1 },
            sourceB: { type: 'seed', seed: 2 },
            teamAId: null,
            teamBId: null,
            lineupA: [],
            lineupB: [],
            scoreA: null,
            scoreB: null,
            playedDate: null,
            winnerTeamId: null,
          },
        ],
      });
      await asUser(db, andre, () =>
        db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
          loaded.competition.id,
          loaded.structureVersion,
          JSON.stringify(withRound),
        ])
      );

      const after = await loadAssembled(db, history.competition.id, andre);
      expect(Number(after.matchVersions[openerId])).toBe(1);
      const kept = listCompetitionMatches(after.competition).find((match) => match.id === openerId);
      expect(kept.scoreA).toBe(21);
      expect(kept.scoreB).toBe(18);
      expect(kept.playedDate).toBe('2026-09-21');
      const eventsAfter = (
        await db.query(
          'select match_version_before, match_version_after from public.competition_match_events where match_id = $1',
          [openerId]
        )
      ).rows;
      expect(eventsAfter).toHaveLength(1);
      expect(Number(eventsAfter[0].match_version_after)).toBe(1);
      expect(Number(after.matchVersions[newMatchId])).toBe(0);
      const created = listCompetitionMatches(after.competition).find((match) => match.id === newMatchId);
      expect(created.scoreA).toBeNull();
      expect(created.scoreB).toBeNull();
      expect(created.playedDate).toBeNull();

      const mutateScore = cloneCompetitionDoc(after.competition);
      const mutateTarget = listCompetitionMatches(mutateScore).find((match) => match.id === openerId);
      mutateTarget.scoreA = 25;
      await expect(
        asUser(db, andre, () =>
          db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
            after.competition.id,
            after.structureVersion,
            JSON.stringify(mutateScore),
          ])
        )
      ).rejects.toThrow(/COMPETITION_SCORE_IMMUTABLE/);

      const removeScored = cloneCompetitionDoc(after.competition);
      for (const stage of removeScored.stages) {
        for (const round of stage.rounds ?? []) {
          round.matches = (round.matches ?? []).filter((match) => match.id !== openerId);
        }
      }
      await expect(
        asUser(db, andre, () =>
          db.query('select public.save_competition_structure($1, $2, $3::jsonb)', [
            after.competition.id,
            after.structureVersion,
            JSON.stringify(removeScored),
          ])
        )
      ).rejects.toThrow(/COMPETITION_MATCH_HAS_HISTORY/);
    });

    it('mesmo match stale -> SCORE_VERSION_CONFLICT; outro match com structure stale -> STRUCTURE_VERSION_CONFLICT', async () => {
      const fresh = await createReadyCompetition(db, {
        ownerId: andre,
        memberId: paulo,
        name: 'Conflito',
        teamCount: 4,
      });
      const firstRound = (fresh.competition.stages[0].rounds ?? []).find((round) => round.number === 1);
      const matchA = firstRound.matches[0].id;
      const matchB = firstRound.matches[1].id;
      const staleMatchVersion = Number(fresh.matchVersions[matchA]);
      const staleStructure = fresh.structureVersion;
      const played = applyScoreDoc(fresh.competition, matchA, 21, 18);
      await setScore(db, paulo, fresh, matchA, 21, 18, '2026-09-21', played);
      const latest = await loadAssembled(db, fresh.competition.id, paulo);

      await expect(
        asUser(db, paulo, () =>
          db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
            fresh.competition.id,
            matchA,
            21,
            19,
            '2026-09-21',
            staleMatchVersion,
            staleStructure,
            JSON.stringify(applyScoreDoc(latest.competition, matchA, 21, 19)),
          ])
        )
      ).rejects.toThrow(/SCORE_VERSION_CONFLICT/);

      await expect(
        asUser(db, paulo, () =>
          db.query('select * from public.set_competition_match_score($1, $2, $3, $4, $5, $6, $7, $8::jsonb)', [
            fresh.competition.id,
            matchB,
            21,
            16,
            '2026-09-21',
            Number(latest.matchVersions[matchB]),
            staleStructure,
            JSON.stringify(applyScoreDoc(latest.competition, matchB, 21, 16)),
          ])
        )
      ).rejects.toThrow(/COMPETITION_STRUCTURE_VERSION_CONFLICT/);
    });
  });
});
