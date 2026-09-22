import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { MATCH_SOURCE_SESSION } from '../domain/performanceMatches.js';
import { getPlayerPerformance } from '../domain/playerPerformance.js';
import { mapCloudPerformanceMatches } from './cloudPerformance.js';
import { buildGroupPerformanceIndex } from './groupPerformance.js';
import { buildGlobalPerformance } from '../community/globalPerformance.js';
import { payloadLooksPrivate } from '../community/mappers.js';
import { mapSocialPerformanceMatches, SOCIAL_MATCH_FORBIDDEN_KEYS } from '../community/socialMatches.js';

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
const etapa7Sql = readFileSync(join(root, 'supabase/migrations/20260922000000_legacy_import.sql'), 'utf8');
const etapa10Sql = readFileSync(
  join(root, 'supabase/migrations/20260922120000_community_beta.sql'),
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

async function insertUserWithoutDisplayName(db, id, email) {
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)',
    [id, email, '{}']
  );
}

function publicIdentityText(row) {
  return `${row.display_name ?? ''} ${row.username ?? ''}`.toLowerCase();
}

function expectNoSocialLeaks(payload) {
  const text = JSON.stringify(payload);
  for (const key of SOCIAL_MATCH_FORBIDDEN_KEYS) {
    expect(text).not.toMatch(new RegExp(`"${key}"`));
  }
  expect(text).not.toContain('Quinta 1');
  expect(text).not.toContain('Só André');
  expect(payloadLooksPrivate(payload)).toBe(false);
}

function parsePayload(row) {
  const value = row.payload ?? Object.values(row)[0];
  return typeof value === 'string' ? JSON.parse(value) : value;
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

describe('etapa 10 comunidade beta', () => {
  let db;
  let andre;
  let paulo;
  let davi;
  let outsider;
  let playerAndre;
  let playerPaulo;
  let playerDavi;
  let playerGuest;
  let groupId;
  let sessionId;
  let andreSessionId;
  let emailDerivedUser;
  let emailDerivedBeforeName;

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

    await db.exec(`
      create schema if not exists storage;
      create table if not exists storage.buckets (
        id text primary key,
        name text not null,
        public boolean default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text not null,
        name text not null,
        owner uuid,
        created_at timestamptz not null default now()
      );
      alter table storage.objects enable row level security;
      alter table storage.objects force row level security;
      grant usage on schema storage to authenticated;
      grant usage on schema storage to anon;
      grant select, insert, update, delete on table storage.objects to authenticated;
    `);

    emailDerivedUser = crypto.randomUUID();
    await insertUserWithoutDisplayName(db, emailDerivedUser, 'carlos.mendes@host.test');
    emailDerivedBeforeName = (
      await db.query('select display_name from public.profiles where id = $1', [emailDerivedUser])
    ).rows[0].display_name;

    await db.exec(etapa10Sql);

    andre = crypto.randomUUID();
    paulo = crypto.randomUUID();
    davi = crypto.randomUUID();
    outsider = crypto.randomUUID();
    await insertUser(db, andre, 'andre@test.com', 'André');
    await insertUser(db, paulo, 'paulo@test.com', 'Paulo');
    await insertUser(db, davi, 'davi@test.com', 'Davi');
    await insertUser(db, outsider, 'out@test.com', 'De fora');

    playerAndre = (await asUser(db, andre, () => db.query("select * from public.create_and_link_player('André')")))
      .rows[0];
    playerPaulo = (await asUser(db, paulo, () => db.query("select * from public.create_and_link_player('Paulo')")))
      .rows[0];
    playerDavi = (await asUser(db, davi, () => db.query("select * from public.create_and_link_player('Davi')"))).rows[0];
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
    const joinCode = (await db.query('select join_code from public.groups where id = $1', [groupId])).rows[0]
      .join_code;
    await asUser(db, paulo, () => db.query('select public.join_group_by_code($1)', [joinCode]));

    sessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
           values ($1, '2026-09-21', 'Quinta 1', 2, 2, $2) returning id`,
          [andre, groupId]
        )
      )
    ).rows[0].id;

    andreSessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Só André', 2, 2) returning id`,
          [andre]
        )
      )
    ).rows[0].id;

    await seedScoredMatch(db, andre, sessionId, {
      a: [playerAndre, playerPaulo],
      b: [playerDavi, playerGuest],
    });
  }, 120_000);

  afterAll(async () => {
    await db?.close?.();
  });

  it('não globaliza display_name derivado do e-mail na etapa 1', async () => {
    expect(emailDerivedBeforeName).toBe('carlos.mendes');
    const after = (
      await db.query('select display_name, username from public.profiles where id = $1', [emailDerivedUser])
    ).rows[0];
    expect(after.display_name).toBe('Jogador');
    const publicText = publicIdentityText(after);
    expect(publicText).not.toContain('carlos');
    expect(publicText).not.toContain('mendes');
    expect(publicText).not.toContain('host');
  });

  it('signup sem display_name não deriva username nem display do e-mail', async () => {
    const userId = crypto.randomUUID();
    await insertUserWithoutDisplayName(db, userId, 'andre.silva@example.com');
    const row = (await db.query('select display_name, username from public.profiles where id = $1', [userId]))
      .rows[0];
    expect(row.display_name).toBe('Jogador');
    expect(row.username).toMatch(/^jogador_[a-f0-9]{8}$/);
    const identity = publicIdentityText(row);
    expect(identity).not.toContain('andre');
    expect(identity).not.toContain('silva');
    expect(identity).not.toContain('example');
    expect(JSON.stringify(row)).not.toContain('andre.silva@example.com');
  });

  it('cria username único sem usar e-mail e permite atualizar o perfil social', async () => {
    const profile = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_my_social_profile() as payload'))).rows[0]
    );
    expect(profile.username).toMatch(/^[a-z0-9_]{3,24}$/);
    expect(profile.username).not.toContain('@');
    expect(profile.display_name).toBe('André');
    expect(JSON.stringify(profile)).not.toContain('andre@test.com');
    expect(JSON.stringify(profile)).not.toMatch(/"email"/);

    const updated = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query("select public.update_my_social_profile('André Col', 'andre', null) as payload")
        )
      ).rows[0]
    );
    expect(updated.username).toBe('andre');
    expect(updated.display_name).toBe('André Col');

    await expect(
      asUser(db, paulo, () => db.query("select public.update_my_social_profile(null, 'andre', null)"))
    ).rejects.toThrow(/USERNAME_TAKEN/);
  });

  it('signup concorrente com o mesmo seed gera usernames distintos', async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await insertUser(db, first, 'ana1@test.com', 'Ana');
    await insertUser(db, second, 'ana2@test.com', 'Ana');
    const rows = (
      await db.query('select id, username, display_name from public.profiles where id in ($1, $2)', [
        first,
        second,
      ])
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.display_name === 'Ana')).toBe(true);
    expect(new Set(rows.map((row) => row.username)).size).toBe(2);
    expect(rows.map((row) => row.username).sort()).toEqual(['ana', 'ana2']);
  });

  it('update concorrente do mesmo username: um ganha, o outro USERNAME_TAKEN', async () => {
    const racerA = crypto.randomUUID();
    const racerB = crypto.randomUUID();
    await insertUser(db, racerA, 'racer.a@test.com', 'Racer A');
    await insertUser(db, racerB, 'racer.b@test.com', 'Racer B');
    const won = parsePayload(
      (
        await asUser(db, racerA, () =>
          db.query("select public.update_my_social_profile(null, 'livre', null) as payload")
        )
      ).rows[0]
    );
    expect(won.username).toBe('livre');
    await expect(
      asUser(db, racerB, () => db.query("select public.update_my_social_profile(null, 'livre', null)"))
    ).rejects.toThrow(/USERNAME_TAKEN/);
  });

  it('search_users_for_friendship não devolve e-mail e limita resultado', async () => {
    const rows = parsePayload(
      (await asUser(db, andre, () => db.query("select public.search_users_for_friendship('pau') as payload")))
        .rows[0]
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].username).toBeTruthy();
    expect(rows[0].display_name).toBe('Paulo');
    expect(JSON.stringify(rows)).not.toContain('paulo@test.com');
    expect(JSON.stringify(rows)).not.toMatch(/"email"/);
    expect(rows.every((row) => row.user_id !== andre)).toBe(true);

    const short = parsePayload(
      (await asUser(db, andre, () => db.query("select public.search_users_for_friendship('p') as payload"))).rows[0]
    );
    expect(short).toEqual([]);
  });

  it('bloqueia self, duplicata, A→B e B→A pendentes, aceita, rejeita, cancela e remove', async () => {
    await expect(
      asUser(db, andre, () => db.query('select public.send_friend_request($1)', [andre]))
    ).rejects.toThrow(/FRIEND_SELF/);

    const sent = parsePayload(
      (await asUser(db, andre, () => db.query('select public.send_friend_request($1) as payload', [paulo]))).rows[0]
    );
    expect(sent.status).toBe('pending');

    await expect(
      asUser(db, andre, () => db.query('select public.send_friend_request($1)', [paulo]))
    ).rejects.toThrow(/FRIEND_REQUEST_PENDING/);
    await expect(
      asUser(db, paulo, () => db.query('select public.send_friend_request($1)', [andre]))
    ).rejects.toThrow(/FRIEND_REQUEST_PENDING/);

    const accepted = parsePayload(
      (
        await asUser(db, paulo, () => db.query('select public.accept_friend_request($1) as payload', [sent.id]))
      ).rows[0]
    );
    expect(accepted.status).toBe('accepted');

    const friends = parsePayload(
      (await asUser(db, andre, () => db.query('select public.list_my_friends() as payload'))).rows[0]
    );
    expect(friends.map((row) => row.user_id)).toContain(paulo);

    await expect(
      asUser(db, andre, () => db.query('select public.send_friend_request($1)', [paulo]))
    ).rejects.toThrow(/FRIEND_ALREADY/);

    await asUser(db, andre, () => db.query('select public.remove_friendship($1)', [paulo]));
    const afterRemove = parsePayload(
      (await asUser(db, andre, () => db.query('select public.list_my_friends() as payload'))).rows[0]
    );
    expect(afterRemove).toEqual([]);

    const toDavi = parsePayload(
      (await asUser(db, andre, () => db.query('select public.send_friend_request($1) as payload', [davi]))).rows[0]
    );
    await asUser(db, davi, () => db.query('select public.reject_friend_request($1)', [toDavi.id]));

    const toOut = parsePayload(
      (await asUser(db, andre, () => db.query('select public.send_friend_request($1) as payload', [outsider])))
        .rows[0]
    );
    await asUser(db, andre, () => db.query('select public.cancel_friend_request($1)', [toOut.id]));
  });

  it('corrida A→B e B→A não devolve 23505 cru', async () => {
    const left = crypto.randomUUID();
    const right = crypto.randomUUID();
    await insertUser(db, left, 'left@test.com', 'Left');
    await insertUser(db, right, 'right@test.com', 'Right');

    const sent = parsePayload(
      (await asUser(db, left, () => db.query('select public.send_friend_request($1) as payload', [right]))).rows[0]
    );
    expect(sent.status).toBe('pending');

    await expect(
      asUser(db, right, () => db.query('select public.send_friend_request($1)', [left]))
    ).rejects.toThrow(/FRIEND_REQUEST_PENDING/);

    await expect(
      db.query(
        'insert into public.friend_requests (sender_user_id, receiver_user_id, status) values ($1, $2, $3)',
        [right, left, 'pending']
      )
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('outsider não manipula pedido alheio e insert direto não força amizade', async () => {
    const sent = parsePayload(
      (await asUser(db, paulo, () => db.query('select public.send_friend_request($1) as payload', [davi]))).rows[0]
    );
    await expect(
      asUser(db, outsider, () => db.query('select public.accept_friend_request($1)', [sent.id]))
    ).rejects.toThrow(/FRIEND_REQUEST_FORBIDDEN/);
    await expect(
      asUser(db, outsider, () => db.query('select public.reject_friend_request($1)', [sent.id]))
    ).rejects.toThrow(/FRIEND_REQUEST_FORBIDDEN/);
    await expect(
      asUser(db, davi, () => db.query('select public.cancel_friend_request($1)', [sent.id]))
    ).rejects.toThrow(/FRIEND_REQUEST_FORBIDDEN/);

    await expect(
      asUser(db, outsider, () =>
        db.query(
          'insert into public.friend_requests (sender_user_id, receiver_user_id, status) values ($1, $2, $3)',
          [outsider, andre, 'accepted']
        )
      )
    ).rejects.toThrow();
  });

  it('amizade não concede acesso a session/group/competition', async () => {
    const request = parsePayload(
      (await asUser(db, andre, () => db.query('select public.send_friend_request($1) as payload', [outsider])))
        .rows[0]
    );
    await asUser(db, outsider, () => db.query('select public.accept_friend_request($1)', [request.id]));

    const sessions = (
      await asUser(db, outsider, () => db.query('select id from public.sessions where id = $1', [andreSessionId]))
    ).rows;
    expect(sessions).toHaveLength(0);

    const members = (
      await asUser(db, outsider, () =>
        db.query('select user_id from public.session_members where session_id = $1', [andreSessionId])
      )
    ).rows;
    expect(members.every((row) => row.user_id !== outsider)).toBe(true);

    const groups = (await asUser(db, outsider, () => db.query('select id from public.groups where id = $1', [groupId])))
      .rows;
    expect(groups).toHaveLength(0);
  });

  it('adicionar amigo ao roster via add_session_player não cria session_member', async () => {
    const rosterBefore = (
      await db.query('select user_id from public.session_members where session_id = $1', [andreSessionId])
    ).rows.map((row) => row.user_id);
    const version = await structureVersion(db, andreSessionId);
    await asUser(db, andre, () =>
      db.query('select public.add_session_player($1, $2, $3, $4)', [
        andreSessionId,
        playerPaulo.id,
        playerPaulo.name,
        version,
      ])
    );
    const rosterAfter = (
      await db.query('select player_id from public.session_players where session_id = $1', [andreSessionId])
    ).rows.map((row) => row.player_id);
    expect(rosterAfter).toContain(playerPaulo.id);
    const membersAfter = (
      await db.query('select user_id from public.session_members where session_id = $1', [andreSessionId])
    ).rows.map((row) => row.user_id);
    expect(membersAfter).toEqual(rosterBefore);
    expect(membersAfter).not.toContain(paulo);
  });

  it('chat: member lê/envia, outsider não, escrita só por RPC, limite e soft delete', async () => {
    const sent = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.send_group_message($1, $2) as payload', [groupId, 'Hoje 19h na quadra'])
        )
      ).rows[0]
    );
    expect(sent.sender_user_id).toBe(andre);
    expect(sent.body).toBe('Hoje 19h na quadra');

    const asPaulo = (
      await asUser(db, paulo, () =>
        db.query('select body, sender_user_id from public.group_messages where group_id = $1', [groupId])
      )
    ).rows;
    expect(asPaulo).toHaveLength(1);

    const asOutsider = (
      await asUser(db, outsider, () =>
        db.query('select body from public.group_messages where group_id = $1', [groupId])
      )
    ).rows;
    expect(asOutsider).toHaveLength(0);

    await expect(
      asUser(db, outsider, () => db.query('select public.send_group_message($1, $2)', [groupId, 'oi']))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);

    await expect(
      asUser(db, paulo, () =>
        db.query('insert into public.group_messages (group_id, sender_user_id, body) values ($1, $2, $3)', [
          groupId,
          paulo,
          'direto',
        ])
      )
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asUser(db, andre, () =>
        db.query('update public.group_messages set body = $1 where id = $2', ['hack', sent.id])
      )
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asUser(db, andre, () => db.query('select public.send_group_message($1, $2)', [groupId, 'x'.repeat(501)]))
    ).rejects.toThrow(/GROUP_MESSAGE_INVALID/);

    const edited = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.edit_group_message($1, $2) as payload', [sent.id, 'Hoje 20h'])
        )
      ).rows[0]
    );
    expect(edited.body).toBe('Hoje 20h');
    expect(edited.edited_at).toBeTruthy();

    await expect(
      asUser(db, paulo, () => db.query('select public.edit_group_message($1, $2)', [sent.id, 'hack']))
    ).rejects.toThrow(/GROUP_MESSAGE_FORBIDDEN/);

    const beforeDelete = Date.now();
    const deleted = parsePayload(
      (await asUser(db, andre, () => db.query('select public.delete_group_message($1) as payload', [sent.id]))).rows[0]
    );
    expect(deleted.body).toBe('');
    expect(deleted.deleted_at).toBeTruthy();
    const deletedMs = new Date(deleted.deleted_at).getTime();
    expect(deletedMs).toBeGreaterThanOrEqual(beforeDelete - 5_000);
    expect(deletedMs).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('usuário removido do grupo deixa de ler e enviar; histórico permanece para membros', async () => {
    const pauloMsg = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.send_group_message($1, $2) as payload', [groupId, 'Ainda membro'])
        )
      ).rows[0]
    );
    await asUser(db, andre, () => db.query('select public.remove_group_member($1, $2)', [groupId, paulo]));

    const remaining = (
      await asUser(db, andre, () =>
        db.query('select body from public.group_messages where group_id = $1 and deleted_at is null', [groupId])
      )
    ).rows;
    expect(remaining.some((row) => row.body === 'Ainda membro')).toBe(true);

    await expect(
      asUser(db, paulo, () => db.query('select public.send_group_message($1, $2)', [groupId, 'depois']))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    await expect(
      asUser(db, paulo, () => db.query('select public.edit_group_message($1, $2)', [pauloMsg.id, 'hack']))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    await expect(
      asUser(db, paulo, () => db.query('select public.delete_group_message($1)', [pauloMsg.id]))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    const asRemoved = (
      await asUser(db, paulo, () =>
        db.query('select id from public.group_messages where group_id = $1', [groupId])
      )
    ).rows;
    expect(asRemoved).toHaveLength(0);
  });

  it('get_global_performance_matches sanitiza, inclui linked, exclui guest do leaderboard e reusa o motor', async () => {
    const payload = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_global_performance_matches() as payload'))).rows[0]
    );
    expectNoSocialLeaks(payload);
    expect(JSON.stringify(payload)).not.toContain('andre@test.com');
    expect(JSON.stringify(payload)).not.toMatch(/"email"/);
    expect(payload.players.map((row) => row.player_id)).toEqual(
      expect.arrayContaining([playerAndre.id, playerPaulo.id, playerDavi.id])
    );
    expect(payload.players.map((row) => row.player_id)).not.toContain(playerGuest.id);
    const match = payload.matches[0];
    const lineupIds = [...match.lineup_a, ...match.lineup_b].map((item) => item.player_id);
    expect(lineupIds).toContain(playerGuest.id);
    expect(match.source_kind).toBe('session');
    expect(match.social_match_id).toMatch(/^[a-f0-9]{32}$/);
    expect(match.origin_key).toMatch(/^[a-f0-9]{32}$/);
    expect(match.source_token).toMatch(/^[a-f0-9]{32}$/);
    expect(match.date).toBeTruthy();

    const model = buildGlobalPerformance(payload);
    expect(model.ranked.map((row) => row.playerId)).toEqual(
      expect.arrayContaining([playerAndre.id, playerPaulo.id, playerDavi.id])
    );
    expect(model.ranked.map((row) => row.playerId)).not.toContain(playerGuest.id);
    expect(mapSocialPerformanceMatches(payload.matches)[0].sourceType).toBe(MATCH_SOURCE_SESSION);

    const groupPayload = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.get_group_performance_matches($1) as payload', [groupId])
        )
      ).rows[0]
    );
    expect(JSON.stringify(groupPayload)).toContain('Quinta 1');
    const groupIndex = buildGroupPerformanceIndex(groupPayload);
    const socialAndre = getPlayerPerformance(model.built.index, playerAndre.id);
    const groupAndre = getPlayerPerformance(groupIndex.built.index, playerAndre.id);
    expect({
      wins: socialAndre.wins,
      matches: socialAndre.matches,
      losses: socialAndre.losses,
      winRate: socialAndre.winRate,
      pointDifference: socialAndre.pointDifference,
    }).toEqual({
      wins: groupAndre.wins,
      matches: groupAndre.matches,
      losses: groupAndre.losses,
      winRate: groupAndre.winRate,
      pointDifference: groupAndre.pointDifference,
    });
    expect(mapCloudPerformanceMatches(groupPayload.matches)[0].sourceName).toBe('Quinta 1');

    await expect(asAnon(db, () => db.query('select public.get_global_performance_matches()'))).rejects.toThrow();
  });

  it('perfil social de outro usuário autenticado e guest sem perfil', async () => {
    const payload = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.get_social_player_profile($1) as payload', [playerAndre.id])
        )
      ).rows[0]
    );
    expect(payload.profile.username).toBeTruthy();
    expect(payload.profile.player_id).toBe(playerAndre.id);
    expect(JSON.stringify(payload)).not.toContain('andre@test.com');
    expectNoSocialLeaks(payload);
    expect(payload.matches[0].source_kind).toBe('session');
    expect(mapSocialPerformanceMatches(payload.matches)[0].sourceName).toBeNull();

    await expect(
      asUser(db, paulo, () => db.query('select public.get_social_player_profile($1)', [playerGuest.id]))
    ).rejects.toThrow(/SOCIAL_PROFILE_UNAVAILABLE/);
  });

  it('authenticated só lê colunas sociais de profiles', async () => {
    const social = (
      await asUser(db, andre, () =>
        db.query('select id, display_name, username, avatar_path from public.profiles where id = $1', [paulo])
      )
    ).rows[0];
    expect(social.id).toBe(paulo);
    expect(social.display_name).toBe('Paulo');
    expect(social.username).toBeTruthy();

    await expect(
      asUser(db, andre, () => db.query('select created_at from public.profiles where id = $1', [paulo]))
    ).rejects.toThrow(/permission denied|column/i);
    await expect(
      asUser(db, andre, () => db.query('select updated_at from public.profiles where id = $1', [paulo]))
    ).rejects.toThrow(/permission denied|column/i);
    await expect(asUser(db, andre, () => db.query('select * from public.profiles limit 1'))).rejects.toThrow(
      /permission denied|column/i
    );
  });

  it('storage avatars: dono grava o próprio prefixo, não o alheio; anon não lê', async () => {
    await asUser(db, andre, () =>
      db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [
        `${andre}/avatar.webp`,
        andre,
      ])
    );

    await expect(
      asUser(db, andre, () =>
        db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [
          `${paulo}/avatar.webp`,
          andre,
        ])
      )
    ).rejects.toThrow();

    await expect(asAnon(db, () => db.query('select name from storage.objects'))).rejects.toThrow(
      /permission denied/i
    );

    const asPaulo = (
      await asUser(db, paulo, () =>
        db.query("select name from storage.objects where bucket_id = 'avatars' and name = $1", [
          `${andre}/avatar.webp`,
        ])
      )
    ).rows;
    expect(asPaulo).toHaveLength(1);
  });

  it('helpers internos não têm execute para authenticated', async () => {
    await expect(
      asUser(db, andre, () => db.query("select private.allocate_username('x')"))
    ).rejects.toThrow();
    await expect(
      asUser(db, andre, () => db.query("select private.random_social_username()"))
    ).rejects.toThrow();
    await expect(
      asUser(db, andre, () => db.query("select private.social_opaque_token('x', 'y')"))
    ).rejects.toThrow();
  });
});
