import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYZABLE_MATCH_PENDING } from '../domain/performanceMatches.js';
import { mapCloudPerformanceMatches } from './cloudPerformance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const preludeSql = readFileSync(join(root, 'supabase/tests/pglite_prelude.sql'), 'utf8');
const etapa1Sql = readFileSync(join(root, 'supabase/migrations/20260921120000_cloud_sessions.sql'), 'utf8');
const etapa2Sql = readFileSync(join(root, 'supabase/migrations/20260921140000_cloud_sessions_etapa2.sql'), 'utf8');
const etapa3Sql = readFileSync(
  join(root, 'supabase/migrations/20260921160000_player_identity_performance.sql'),
  'utf8'
);
const etapa4Sql = readFileSync(join(root, 'supabase/migrations/20260921180000_cloud_groups.sql'), 'utf8');
const etapa5Sql = readFileSync(
  join(root, 'supabase/migrations/20260921200000_group_performance.sql'),
  'utf8'
);
const etapa6Sql = readFileSync(
  join(root, 'supabase/migrations/20260921220000_cloud_competitions.sql'),
  'utf8'
);

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
  const payload = row.payload ?? row.get_group_performance_matches;
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

async function structureVersion(db, sessionId) {
  return Number(
    (await db.query('select structure_version from public.sessions where id = $1', [sessionId])).rows[0]
      .structure_version
  );
}

async function seedScoredMatch(db, ownerId, sessionId, players, { scoreA = 21, scoreB = 18 } = {}) {
  const teamA = crypto.randomUUID();
  const teamB = crypto.randomUUID();
  const roundId = crypto.randomUUID();
  const matchId = crypto.randomUUID();
  const [leftA, rightA] = players.a;
  const [leftB, rightB] = players.b;

  await asUser(db, ownerId, async () => {
    for (const player of [...players.a, ...players.b]) {
      const version = await structureVersion(db, sessionId);
      await db.query('select public.add_session_player($1, $2, $3, $4)', [
        sessionId,
        player.id,
        player.name,
        version,
      ]);
    }
    const afterPlayers = await structureVersion(db, sessionId);
    await db.query('select public.replace_session_teams($1, $2, $3::jsonb)', [
      sessionId,
      afterPlayers,
      JSON.stringify([
        {
          id: teamA,
          name: 'A',
          sort_index: 0,
          members: players.a.map((player) => ({
            player_id: player.id,
            player_name_snapshot: player.name,
          })),
        },
        {
          id: teamB,
          name: 'B',
          sort_index: 1,
          members: players.b.map((player) => ({
            player_id: player.id,
            player_name_snapshot: player.name,
          })),
        },
      ]),
    ]);
    const afterTeams = await structureVersion(db, sessionId);
    await db.query('select public.apply_session_rounds($1, $2, $3, $4::jsonb, 1)', [
      sessionId,
      afterTeams,
      'replace',
      JSON.stringify([
        {
          id: roundId,
          number: 1,
          cycle_number: 1,
          bye_team_id: null,
          matches: [
            {
              id: matchId,
              team_a_id: teamA,
              team_b_id: teamB,
              lineup_a: [
                { player_id: leftA.id, player_name_snapshot: leftA.name, sort_index: 0 },
                { player_id: rightA.id, player_name_snapshot: rightA.name, sort_index: 1 },
              ],
              lineup_b: [
                { player_id: leftB.id, player_name_snapshot: leftB.name, sort_index: 0 },
                { player_id: rightB.id, player_name_snapshot: rightB.name, sort_index: 1 },
              ],
            },
          ],
        },
      ]),
    ]);
  });

  if (scoreA != null) {
    const matchVersion = (await db.query('select version from public.matches where id = $1', [matchId])).rows[0]
      .version;
    await asUser(db, ownerId, () =>
      db.query('select * from public.set_match_score($1, $2, $3, $4)', [matchId, scoreA, scoreB, matchVersion])
    );
  }
  return matchId;
}

async function seedEmptyLineupMatch(db, ownerId, sessionId, players) {
  const teamA = crypto.randomUUID();
  const teamB = crypto.randomUUID();
  const roundId = crypto.randomUUID();
  const matchId = crypto.randomUUID();

  await asUser(db, ownerId, async () => {
    for (const player of players) {
      const version = await structureVersion(db, sessionId);
      await db.query('select public.add_session_player($1, $2, $3, $4)', [
        sessionId,
        player.id,
        player.name,
        version,
      ]);
    }
    const afterPlayers = await structureVersion(db, sessionId);
    await db.query('select public.replace_session_teams($1, $2, $3::jsonb)', [
      sessionId,
      afterPlayers,
      JSON.stringify([
        {
          id: teamA,
          name: 'A',
          sort_index: 0,
          members: [{ player_id: players[0].id, player_name_snapshot: players[0].name }],
        },
        {
          id: teamB,
          name: 'B',
          sort_index: 1,
          members: [{ player_id: players[1].id, player_name_snapshot: players[1].name }],
        },
      ]),
    ]);
    const afterTeams = await structureVersion(db, sessionId);
    await db.query('select public.apply_session_rounds($1, $2, $3, $4::jsonb, 1)', [
      sessionId,
      afterTeams,
      'replace',
      JSON.stringify([
        {
          id: roundId,
          number: 1,
          cycle_number: 1,
          bye_team_id: null,
          matches: [
            {
              id: matchId,
              team_a_id: teamA,
              team_b_id: teamB,
              lineup_a: [],
              lineup_b: [],
            },
          ],
        },
      ]),
    ]);
  });

  return matchId;
}

describe('get_group_performance_matches', () => {
  let db;
  let andre;
  let paulo;
  let davi;
  let idle;
  let unlinked;
  let outsider;
  let groupId;
  let otherGroupId;
  let groupSessionId;
  let pendingSessionId;
  let avulsoSessionId;
  let otherGroupSessionId;
  let playerAndre;
  let playerPaulo;
  let playerDavi;
  let playerIdle;
  let playerGuest;
  let groupMatchId;
  let pendingMatchId;

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
    idle = crypto.randomUUID();
    unlinked = crypto.randomUUID();
    outsider = crypto.randomUUID();
    await insertUser(db, andre, 'andre@test.com', 'André');
    await insertUser(db, paulo, 'paulo@test.com', 'Paulo');
    await insertUser(db, davi, 'davi@test.com', 'Davi');
    await insertUser(db, idle, 'idle@test.com', 'Idle');
    await insertUser(db, unlinked, 'unlinked@test.com', 'Sem vínculo');
    await insertUser(db, outsider, 'out@test.com', 'De fora');

    playerAndre = (await asUser(db, andre, () => db.query("select * from public.create_and_link_player('André')")))
      .rows[0];
    playerPaulo = (await asUser(db, paulo, () => db.query("select * from public.create_and_link_player('Paulo')")))
      .rows[0];
    playerDavi = (await asUser(db, davi, () => db.query("select * from public.create_and_link_player('Davi')"))).rows[0];
    playerIdle = (await asUser(db, idle, () => db.query("select * from public.create_and_link_player('Idle')"))).rows[0];
    playerGuest = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Convidado', $1, 3, 'M', 'short') returning id, name`,
          [andre]
        )
      )
    ).rows[0];

    groupId = (await asUser(db, andre, () => db.query("select * from public.create_group('Vôlei Quinta', null)")))
      .rows[0].id;
    const joinCode = (await db.query('select join_code from public.groups where id = $1', [groupId])).rows[0].join_code;
    await asUser(db, paulo, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, davi, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, idle, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, unlinked, () => db.query('select public.join_group_by_code($1)', [joinCode]));

    otherGroupId = (await asUser(db, outsider, () => db.query("select * from public.create_group('UFJF', null)")))
      .rows[0].id;

    groupSessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
           values ($1, '2026-09-21', 'Quinta 1', 2, 2, $2) returning id`,
          [andre, groupId]
        )
      )
    ).rows[0].id;

    pendingSessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
           values ($1, '2026-09-22', 'Quinta 2', 2, 2, $2) returning id`,
          [andre, groupId]
        )
      )
    ).rows[0].id;

    avulsoSessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Avulso', 2, 2) returning id`,
          [andre]
        )
      )
    ).rows[0].id;

    otherGroupSessionId = (
      await asUser(db, outsider, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
           values ($1, '2026-09-21', 'UFJF 1', 2, 2, $2) returning id`,
          [outsider, otherGroupId]
        )
      )
    ).rows[0].id;

    const side = (id, name) => ({ id, name });
    groupMatchId = await seedScoredMatch(db, andre, groupSessionId, {
      a: [side(playerAndre.id, 'André'), side(playerPaulo.id, 'Paulo')],
      b: [side(playerDavi.id, 'Davi'), side(playerGuest.id, 'Convidado')],
    });
    pendingMatchId = await seedScoredMatch(
      db,
      andre,
      pendingSessionId,
      {
        a: [side(playerAndre.id, 'André'), side(playerDavi.id, 'Davi')],
        b: [side(playerPaulo.id, 'Paulo'), side(playerGuest.id, 'Convidado')],
      },
      { scoreA: null, scoreB: null }
    );

    await seedScoredMatch(db, andre, avulsoSessionId, {
      a: [side(playerAndre.id, 'André'), side(playerPaulo.id, 'Paulo')],
      b: [side(playerDavi.id, 'Davi'), side(playerGuest.id, 'Convidado')],
    });

    const outsiderPlayer = (
      await asUser(db, outsider, () => db.query("select * from public.create_and_link_player('Fora')"))
    ).rows[0];
    const filler = (
      await asUser(db, outsider, () =>
        db.query(
          `insert into public.players (name, created_by) values ('Parceiro', $1) returning id, name`,
          [outsider]
        )
      )
    ).rows[0];
    const extraA = (
      await asUser(db, outsider, () =>
        db.query(`insert into public.players (name, created_by) values ('A2', $1) returning id, name`, [outsider])
      )
    ).rows[0];
    const extraB = (
      await asUser(db, outsider, () =>
        db.query(`insert into public.players (name, created_by) values ('B2', $1) returning id, name`, [outsider])
      )
    ).rows[0];
    await seedScoredMatch(db, outsider, otherGroupSessionId, {
      a: [side(outsiderPlayer.id, 'Fora'), side(filler.id, 'Parceiro')],
      b: [side(extraA.id, 'A2'), side(extraB.id, 'B2')],
    });
  }, 90000);

  afterAll(async () => {
    await db?.close?.();
  });

  it('owner, admin e member leem o read model; outsider, outro grupo, anon e jwt vazio são bloqueados', async () => {
    await asUser(db, andre, () =>
      db.query('select public.set_group_member_role($1, $2, $3)', [groupId, paulo, 'admin'])
    );

    const asOwner = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    const asAdmin = parsePayload(
      (await asUser(db, paulo, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    const asMember = parsePayload(
      (await asUser(db, davi, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );

    expect(asOwner.group_id).toBe(groupId);
    expect(asAdmin.matches).toHaveLength(asOwner.matches.length);
    expect(asMember.members.some((member) => member.user_id === davi)).toBe(true);

    await expect(
      asUser(db, outsider, () => db.query('select public.get_group_performance_matches($1)', [groupId]))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    await expect(
      asUser(db, andre, () => db.query('select public.get_group_performance_matches($1)', [otherGroupId]))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    await expect(
      asUser(db, null, () => db.query('select public.get_group_performance_matches($1)', [groupId]))
    ).rejects.toThrow(/AUTH_REQUIRED/);
    await expect(
      asAnon(db, () => db.query('select public.get_group_performance_matches($1)', [groupId]))
    ).rejects.toThrow();
    await expect(
      asUser(db, andre, () => db.query('select public.get_group_performance_matches($1)', [crypto.randomUUID()]))
    ).rejects.toThrow(/GROUP_NOT_FOUND/);
  });

  it('só sessions do grupo entram; avulso e outro grupo ficam de fora; pendente chega sem placar', async () => {
    const payload = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    const sessionIds = payload.matches.map((match) => match.session_id);
    expect(sessionIds).toContain(groupSessionId);
    expect(sessionIds).toContain(pendingSessionId);
    expect(sessionIds).not.toContain(avulsoSessionId);
    expect(sessionIds).not.toContain(otherGroupSessionId);
    expect(payload.matches.some((match) => match.match_id === groupMatchId)).toBe(true);
    expect(payload.matches.some((match) => match.match_id === pendingMatchId && match.score_a == null)).toBe(true);
    expect(payload).not.toHaveProperty('winRate');
    expect(payload.matches[0]).not.toHaveProperty('sourceType');
  });

  it('mapeia linked players, inclui convidado na partida e trata membro sem player / sem partidas', async () => {
    const payload = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    const andreMember = payload.members.find((member) => member.user_id === andre);
    expect(andreMember.player_id).toBe(playerAndre.id);
    expect(andreMember.player_name).toBe('André');
    expect(payload.members.find((member) => member.user_id === idle).player_id).toBe(playerIdle.id);
    expect(payload.members.find((member) => member.user_id === unlinked).player_id).toBeNull();

    const scored = payload.matches.find((match) => match.match_id === groupMatchId);
    const lineupIds = [...scored.lineup_a, ...scored.lineup_b].map((item) => item.player_id);
    expect(lineupIds).toContain(playerGuest.id);
    expect(payload.members.some((member) => member.player_id === playerGuest.id)).toBe(false);
    expect(payload.members.map((member) => member.user_id)).toEqual(
      expect.arrayContaining([andre, paulo, davi, idle, unlinked])
    );
  });

  it('não vaza email, join_code, session_members nem papéis de sessão', async () => {
    const payload = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    const raw = JSON.stringify(payload);
    expect(raw).not.toMatch(/join_code/);
    expect(raw).not.toMatch(/andre@test\.com/);
    expect(raw).not.toMatch(/session_members/);
    expect(raw).not.toMatch(/"role":"viewer"/);
    expect(payload.matches[0]).not.toHaveProperty('join_code');
    expect(payload).not.toHaveProperty('email');
    expect(etapa5Sql).not.toMatch(/create policy/i);
    expect(etapa5Sql).not.toMatch(/alter policy/i);
    expect(etapa5Sql).not.toMatch(/from public\.session_members/i);
  });

  it('group_member sem session access não lê a session bruta; perfil pessoal continua vendo avulso', async () => {
    const visible = await asUser(db, paulo, () =>
      db.query('select id from public.sessions where id = $1', [groupSessionId])
    );
    expect(visible.rows).toHaveLength(0);

    const personal = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_my_performance_matches() as payload'))).rows[0]
    );
    const personalSessions = personal.matches.map((match) => match.session_id);
    expect(personalSessions).toContain(avulsoSessionId);
    expect(personalSessions).toContain(groupSessionId);

    const group = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    expect(group.matches.map((match) => match.session_id)).not.toContain(avulsoSessionId);
  });

  it('match sem match_players chega ao read model com lineups vazios para o JS classificar', async () => {
    const emptySessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
           values ($1, '2026-09-23', 'Quinta vazia', 2, 2, $2) returning id`,
          [andre, groupId]
        )
      )
    ).rows[0].id;
    const emptyMatchId = await seedEmptyLineupMatch(db, andre, emptySessionId, [
      { id: playerAndre.id, name: 'André' },
      { id: playerPaulo.id, name: 'Paulo' },
    ]);

    const players = await db.query('select 1 from public.match_players where match_id = $1', [emptyMatchId]);
    expect(players.rows).toHaveLength(0);

    const payload = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_performance_matches($1) as payload', [groupId])))
        .rows[0]
    );
    const row = payload.matches.find((match) => match.match_id === emptyMatchId);
    expect(row).toBeTruthy();
    expect(row.lineup_a).toEqual([]);
    expect(row.lineup_b).toEqual([]);
    expect(row.score_a).toBeNull();
    expect(row.score_b).toBeNull();

    const mapped = mapCloudPerformanceMatches([row]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].status).toBe(ANALYZABLE_MATCH_PENDING);
    expect(mapped[0].lineupA).toEqual([]);
    expect(mapped[0].lineupB).toEqual([]);
  });
}, 90000);
