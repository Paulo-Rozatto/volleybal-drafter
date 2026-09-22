import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

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
const etapa7Sql = readFileSync(join(root, 'supabase/migrations/20260922000000_legacy_import.sql'), 'utf8');
const etapa10Sql = readFileSync(join(root, 'supabase/migrations/20260922120000_community_beta.sql'), 'utf8');
const etapa11Sql = readFileSync(join(root, 'supabase/migrations/20260922160000_group_scheduling.sql'), 'utf8');

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

async function insertUser(db, id, email, name) {
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)',
    [id, email, JSON.stringify({ display_name: name })]
  );
}

function parsePayload(row) {
  const value = row.payload ?? Object.values(row)[0];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

describe('etapa 11 scheduling', () => {
  let db;
  let andre;
  let paulo;
  let davi;
  let maria;
  let outsider;
  let groupId;
  let otherGroupId;
  let playerAndre;
  let playerPaulo;
  const windowStart = '2026-10-03T00:00:00.000Z';
  const windowEnd = '2026-10-10T00:00:00.000Z';
  const slotA = '2026-10-03T21:00:00.000Z';
  const slotB = '2026-10-03T21:30:00.000Z';
  const slotC = '2026-10-03T22:00:00.000Z';
  const slotD = '2026-10-03T22:30:00.000Z';
  const outsideSlot = '2026-10-12T21:00:00.000Z';
  const proposalStart = '2026-10-03T21:00:00.000Z';
  const proposalEnd = '2026-10-03T23:00:00.000Z';

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
    `);
    await db.exec(etapa10Sql);
    await db.exec(etapa11Sql);

    andre = crypto.randomUUID();
    paulo = crypto.randomUUID();
    davi = crypto.randomUUID();
    maria = crypto.randomUUID();
    outsider = crypto.randomUUID();
    await insertUser(db, andre, 'andre@test.com', 'André');
    await insertUser(db, paulo, 'paulo@test.com', 'Paulo');
    await insertUser(db, davi, 'davi@test.com', 'Davi');
    await insertUser(db, maria, 'maria@test.com', 'Maria');
    await insertUser(db, outsider, 'out@test.com', 'De fora');

    playerAndre = (await asUser(db, andre, () => db.query("select * from public.create_and_link_player('André')")))
      .rows[0];
    playerPaulo = (await asUser(db, paulo, () => db.query("select * from public.create_and_link_player('Paulo')")))
      .rows[0];

    groupId = (await asUser(db, andre, () => db.query("select * from public.create_group('Vôlei Quinta', null)")))
      .rows[0].id;
    const joinCode = (await db.query('select join_code from public.groups where id = $1', [groupId])).rows[0]
      .join_code;
    await asUser(db, paulo, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, davi, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, maria, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, andre, () =>
      db.query('select public.set_group_member_role($1, $2, $3)', [groupId, davi, 'admin'])
    );

    otherGroupId = (await asUser(db, outsider, () => db.query("select * from public.create_group('Outra', null)")))
      .rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.close?.();
  });

  it('novos grupos usam America/Sao_Paulo e rejeitam timezone inválido', async () => {
    const tz = (await db.query('select timezone from public.groups where id = $1', [groupId])).rows[0].timezone;
    expect(tz).toBe('America/Sao_Paulo');
    await asUser(db, andre, () =>
      db.query('select public.update_group_timezone($1, $2)', [groupId, 'America/Manaus'])
    );
    await expect(
      asUser(db, andre, () => db.query('select public.update_group_timezone($1, $2)', [groupId, 'Not/AZone']))
    ).rejects.toThrow(/GROUP_TIMEZONE_INVALID/);
    await asUser(db, andre, () =>
      db.query('select public.update_group_timezone($1, $2)', [groupId, 'America/Sao_Paulo'])
    );
  });

  it('member grava próprios slots e outsider é bloqueado', async () => {
    const saved = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
            groupId,
            windowStart,
            windowEnd,
            [slotA, slotB, slotC, slotD],
          ])
        )
      ).rows[0]
    );
    expect(saved.saved).toBe(4);
    expect(saved.user_id).toBe(andre);

    await expect(
      asUser(db, outsider, () =>
        db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
          groupId,
          windowStart,
          windowEnd,
          [slotA],
        ])
      )
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
  });

  it('user A não grava para B; slot 18:17, passado e >90 dias bloqueiam', async () => {
    await asUser(db, paulo, () =>
      db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
        groupId,
        windowStart,
        windowEnd,
        [slotA, slotB],
      ])
    );
    const andreSlots = (
      await db.query('select user_id from public.group_availability_slots where group_id = $1 and slot_start = $2', [
        groupId,
        slotC,
      ])
    ).rows;
    expect(andreSlots.every((row) => row.user_id === andre)).toBe(true);

    await expect(
      asUser(db, andre, () =>
        db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
          groupId,
          windowStart,
          windowEnd,
          ['2026-10-03T21:17:00.000Z'],
        ])
      )
    ).rejects.toThrow(/AVAILABILITY_SLOT_INVALID/);

    await expect(
      asUser(db, andre, () =>
        db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
          groupId,
          '2020-01-01T00:00:00.000Z',
          '2020-01-02T00:00:00.000Z',
          ['2020-01-01T21:00:00.000Z'],
        ])
      )
    ).rejects.toThrow(/AVAILABILITY_SLOT_INVALID/);

    await expect(
      asUser(db, andre, () =>
        db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
          groupId,
          '2027-01-01T00:00:00.000Z',
          '2027-01-02T00:00:00.000Z',
          ['2027-01-01T21:00:00.000Z'],
        ])
      )
    ).rejects.toThrow(/AVAILABILITY_SLOT_INVALID/);
  });

  it('range inválido bloqueia e batch não apaga fora da janela nem outro usuário', async () => {
    await asUser(db, andre, () =>
      db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
        groupId,
        '2026-10-10T00:00:00.000Z',
        '2026-10-20T00:00:00.000Z',
        [outsideSlot],
      ])
    );
    await asUser(db, andre, () =>
      db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
        groupId,
        windowStart,
        windowEnd,
        [slotA],
      ])
    );
    const kept = (
      await db.query(
        'select slot_start::text from public.group_availability_slots where group_id = $1 and user_id = $2 order by slot_start',
        [groupId, andre]
      )
    ).rows.map((row) => row.slot_start);
    expect(kept.some((value) => String(value).startsWith('2026-10-03'))).toBe(true);
    expect(kept.some((value) => String(value).includes('10-12'))).toBe(true);
    const pauloCount = Number(
      (
        await db.query(
          'select count(*)::int as n from public.group_availability_slots where group_id = $1 and user_id = $2',
          [groupId, paulo]
        )
      ).rows[0].n
    );
    expect(pauloCount).toBeGreaterThan(0);

    await expect(
      asUser(db, andre, () =>
        db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
          groupId,
          windowStart,
          windowStart,
          [slotA],
        ])
      )
    ).rejects.toThrow(/AVAILABILITY_RANGE_INVALID/);
  });

  it('leitura só para member, sem e-mail, e leave remove acesso', async () => {
    const payload = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.get_group_availability($1, $2, $3)', [groupId, windowStart, windowEnd])
        )
      ).rows[0]
    );
    expect(payload.timezone).toBe('America/Sao_Paulo');
    expect(JSON.stringify(payload)).not.toContain('@test.com');
    expect(payload.members.map((row) => row.user_id).sort()).toEqual([andre, davi, maria, paulo].sort());

    await expect(
      asUser(db, outsider, () =>
        db.query('select public.get_group_availability($1, $2, $3)', [groupId, windowStart, windowEnd])
      )
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);

    const extra = crypto.randomUUID();
    await insertUser(db, extra, 'extra@test.com', 'Extra');
    const joinCode = (await db.query('select join_code from public.groups where id = $1', [groupId])).rows[0]
      .join_code;
    await asUser(db, extra, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, extra, () =>
      db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
        groupId,
        windowStart,
        windowEnd,
        [slotA],
      ])
    );
    await asUser(db, extra, () => db.query('select public.leave_group($1)', [groupId]));
    await expect(
      asUser(db, extra, () =>
        db.query('select public.get_group_availability($1, $2, $3)', [groupId, windowStart, windowEnd])
      )
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    const leftover = Number(
      (
        await db.query(
          'select count(*)::int as n from public.group_availability_slots where group_id = $1 and user_id = $2',
          [groupId, extra]
        )
      ).rows[0].n
    );
    expect(leftover).toBe(0);
  });

  it('member cria proposta; outsider bloqueado; tempos inválidos bloqueiam', async () => {
    const created = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Jogo de sábado',
            proposalStart,
            proposalEnd,
            'Quadra do Bairro',
            'Rua X',
            'Levar bola',
          ])
        )
      ).rows[0]
    );
    expect(created.status).toBe('open');
    expect(created.created_by).toBe(paulo);
    expect(created.counts.yes).toBe(0);

    await expect(
      asUser(db, outsider, () =>
        db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
          groupId,
          'Hack',
          proposalStart,
          proposalEnd,
          null,
          null,
          null,
        ])
      )
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);

    await expect(
      asUser(db, andre, () =>
        db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
          groupId,
          'Ruim',
          proposalEnd,
          proposalStart,
          null,
          null,
          null,
        ])
      )
    ).rejects.toThrow(/PROPOSAL_TIME_INVALID/);
  });

  it('só criador/admin/owner editam; member terceiro não; cancelada não volta', async () => {
    const proposal = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Editável',
            proposalStart,
            proposalEnd,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );

    await expect(
      asUser(db, maria, () =>
        db.query('select public.update_group_game_proposal($1, $2, $3, $4, $5, $6, $7, $8)', [
          proposal.id,
          proposal.version,
          'Não pode',
          null,
          null,
          null,
          null,
          null,
        ])
      )
    ).rejects.toThrow(/PROPOSAL_FORBIDDEN/);

    const byAdmin = parsePayload(
      (
        await asUser(db, davi, () =>
          db.query('select public.update_group_game_proposal($1, $2, $3, $4, $5, $6, $7, $8)', [
            proposal.id,
            proposal.version,
            'Admin editou',
            null,
            null,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    expect(byAdmin.title).toBe('Admin editou');
    expect(byAdmin.version).toBe(proposal.version + 1);

    const byOwner = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.update_group_game_proposal($1, $2, $3, $4, $5, $6, $7, $8)', [
            proposal.id,
            byAdmin.version,
            'Owner editou',
            null,
            null,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    expect(byOwner.title).toBe('Owner editou');

    const byCreator = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.update_group_game_proposal($1, $2, $3, $4, $5, $6, $7, $8)', [
            proposal.id,
            byOwner.version,
            'Criador editou',
            null,
            null,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    expect(byCreator.title).toBe('Criador editou');

    await expect(
      asUser(db, paulo, () =>
        db.query('select public.update_group_game_proposal($1, $2, $3, $4, $5, $6, $7, $8)', [
          proposal.id,
          byOwner.version,
          'stale',
          null,
          null,
          null,
          null,
          null,
        ])
      )
    ).rejects.toThrow(/PROPOSAL_VERSION_CONFLICT/);

    const cancelled = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.cancel_group_game_proposal($1, $2)', [proposal.id, byCreator.version])
        )
      ).rows[0]
    );
    expect(cancelled.status).toBe('cancelled');
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.update_group_game_proposal($1, $2, $3, $4, $5, $6, $7, $8)', [
          proposal.id,
          cancelled.version,
          'voltar',
          null,
          null,
          null,
          null,
          null,
        ])
      )
    ).rejects.toThrow(/PROPOSAL_CANCELLED/);
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
      )
    ).rejects.toThrow(/PROPOSAL_CANCELLED/);
  });

  it('RSVP próprio, inválido bloqueado, read model sem N+1 e privacidade entre grupos', async () => {
    const proposal = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'RSVP',
            proposalStart,
            proposalEnd,
            'Quadra X',
            null,
            null,
          ])
        )
      ).rows[0]
    );
    await asUser(db, paulo, () =>
      db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
    );
    await asUser(db, maria, () =>
      db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'maybe'])
    );
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'sim'])
      )
    ).rejects.toThrow(/PROPOSAL_RESPONSE_INVALID/);
    await expect(
      asUser(db, outsider, () =>
        db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
      )
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);

    const listed = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_game_proposals($1)', [groupId]))).rows[0]
    );
    expect(listed.proposals.length).toBeGreaterThan(1);
    const row = listed.proposals.find((item) => item.id === proposal.id);
    expect(row.counts).toMatchObject({ yes: 1, maybe: 1 });
    expect(JSON.stringify(listed)).not.toContain('@test.com');

    await expect(
      asUser(db, outsider, () => db.query('select public.get_group_game_proposals($1)', [groupId]))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
    await expect(
      asUser(db, andre, () => db.query('select public.get_group_game_proposals($1)', [otherGroupId]))
    ).rejects.toThrow(/GROUP_ACCESS_DENIED/);
  });

  it('conversão cria uma session, é idempotente e não copia RSVP para roster/acesso', async () => {
    const proposal = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Jogo confirmado',
            proposalStart,
            proposalEnd,
            'Quadra X',
            null,
            null,
          ])
        )
      ).rows[0]
    );
    await asUser(db, paulo, () =>
      db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
    );
    await asUser(db, maria, () =>
      db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
    );
    const confirmed = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.confirm_group_game_proposal($1, $2)', [proposal.id, proposal.version])
        )
      ).rows[0]
    );
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.linked_session_id).toBeNull();

    const first = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_session_from_group_proposal($1, $2, 2, 2)', [
            proposal.id,
            confirmed.version,
          ])
        )
      ).rows[0]
    );
    expect(first.already_linked).toBe(false);
    expect(first.session_id).toBeTruthy();
    const session = (
      await db.query('select id, name, date, group_id from public.sessions where id = $1', [first.session_id])
    ).rows[0];
    expect(session.name).toBe('Jogo confirmado');
    expect(session.group_id).toBe(groupId);
    expect(new Date(session.date).toISOString().slice(0, 10)).toBe('2026-10-03');

    const members = (
      await db.query('select user_id, role from public.session_members where session_id = $1', [first.session_id])
    ).rows;
    expect(members).toHaveLength(1);
    expect(members[0].user_id).toBe(andre);
    const playersBefore = Number(
      (
        await db.query('select count(*)::int as n from public.session_players where session_id = $1', [
          first.session_id,
        ])
      ).rows[0].n
    );
    expect(playersBefore).toBe(0);

    const second = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_session_from_group_proposal($1, $2, 2, 2)', [
            proposal.id,
            confirmed.version,
          ])
        )
      ).rows[0]
    );
    expect(second.already_linked).toBe(true);
    expect(second.session_id).toBe(first.session_id);
    const sessionCount = Number(
      (await db.query('select count(*)::int as n from public.sessions where group_id = $1 and name = $2', [
        groupId,
        'Jogo confirmado',
      ])).rows[0].n
    );
    expect(sessionCount).toBe(1);

    const version = Number(
      (await db.query('select structure_version from public.sessions where id = $1', [first.session_id])).rows[0]
        .structure_version
    );
    await asUser(db, andre, () =>
      db.query('select public.add_session_player($1, $2, $3, $4)', [
        first.session_id,
        playerPaulo.id,
        playerPaulo.name,
        version,
      ])
    );
    const playersAfter = (
      await db.query('select player_id from public.session_players where session_id = $1', [first.session_id])
    ).rows.map((row) => row.player_id);
    expect(playersAfter).toEqual([playerPaulo.id]);
    expect(playersAfter).not.toContain(playerAndre.id);

    await expect(
      asUser(db, paulo, () =>
        db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'no'])
      )
    ).rejects.toThrow(/PROPOSAL_ALREADY_LINKED/);
  });

  it('RSVP concorrente com cancelamento: lock antes de membership/status', async () => {
    const respondDef = (
      await db.query(
        `select pg_catalog.pg_get_functiondef('public.respond_to_group_game_proposal(uuid, text)'::regprocedure) as def`
      )
    ).rows[0].def.toLowerCase();
    const lockDef = (
      await db.query(
        `select pg_catalog.pg_get_functiondef('private.lock_group_proposal(uuid, bigint)'::regprocedure) as def`
      )
    ).rows[0].def.toLowerCase();
    expect(lockDef).toMatch(/for update/);
    expect(respondDef.indexOf('lock_group_proposal')).toBeGreaterThan(-1);
    expect(respondDef.indexOf('is_group_member')).toBeGreaterThan(respondDef.indexOf('lock_group_proposal'));
    expect(respondDef.indexOf('proposal_cancelled')).toBeGreaterThan(respondDef.indexOf('lock_group_proposal'));
    expect(respondDef.indexOf('linked_session_id')).toBeGreaterThan(respondDef.indexOf('lock_group_proposal'));

    const proposal = parsePayload(
      (
        await asUser(db, paulo, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Corrida cancel',
            proposalStart,
            proposalEnd,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    await asUser(db, andre, () =>
      db.query('select public.cancel_group_game_proposal($1, $2)', [proposal.id, proposal.version])
    );
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
      )
    ).rejects.toThrow(/PROPOSAL_CANCELLED/);
  });

  it('RSVP concorrente com conversion: vê linked_session_id depois do lock', async () => {
    const proposal = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Corrida conversion',
            proposalStart,
            proposalEnd,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    const confirmed = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.confirm_group_game_proposal($1, $2)', [proposal.id, proposal.version])
        )
      ).rows[0]
    );
    await asUser(db, andre, () =>
      db.query('select public.create_session_from_group_proposal($1, $2, 2, 2)', [
        proposal.id,
        confirmed.version,
      ])
    );
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
      )
    ).rejects.toThrow(/PROPOSAL_ALREADY_LINKED/);
  });

  it('Asia/Kathmandu: 18:00 e 18:30 locais aceitos; 18:15 local rejeitado', async () => {
    const ktmGroup = (
      await asUser(db, andre, () => db.query("select * from public.create_group('Kathmandu', null)"))
    ).rows[0].id;
    await asUser(db, andre, () =>
      db.query('select public.update_group_timezone($1, $2)', [ktmGroup, 'Asia/Kathmandu'])
    );
    const slots = (
      await db.query(
        `select
           (timestamp '2026-10-03 18:00:00' at time zone 'Asia/Kathmandu') as t00,
           (timestamp '2026-10-03 18:30:00' at time zone 'Asia/Kathmandu') as t30,
           (timestamp '2026-10-03 18:15:00' at time zone 'Asia/Kathmandu') as t15`
      )
    ).rows[0];

    await asUser(db, andre, () =>
      db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
        ktmGroup,
        '2026-10-03T00:00:00.000Z',
        '2026-10-04T00:00:00.000Z',
        [slots.t00, slots.t30],
      ])
    );
    const saved = Number(
      (
        await db.query(
          'select count(*)::int as n from public.group_availability_slots where group_id = $1 and user_id = $2',
          [ktmGroup, andre]
        )
      ).rows[0].n
    );
    expect(saved).toBe(2);

    await expect(
      asUser(db, andre, () =>
        db.query('select public.set_my_group_availability($1, $2, $3, $4::timestamptz[])', [
          ktmGroup,
          '2026-10-03T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
          [slots.t15],
        ])
      )
    ).rejects.toThrow(/AVAILABILITY_SLOT_INVALID/);
  });

  it('membro com RSVP sai do grupo e some de counts/responses; linha histórica permanece', async () => {
    const proposal = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'RSVP saída',
            proposalStart,
            proposalEnd,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    await asUser(db, paulo, () =>
      db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
    );
    await asUser(db, maria, () =>
      db.query('select public.respond_to_group_game_proposal($1, $2)', [proposal.id, 'yes'])
    );

    const before = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_game_proposal($1)', [proposal.id]))).rows[0]
    ).proposal;
    expect(before.counts.yes).toBe(2);
    expect(before.responses.map((row) => row.user_id).sort()).toEqual([maria, paulo].sort());

    const membersBefore = Number(
      (await db.query('select count(*)::int as n from public.group_members where group_id = $1', [groupId])).rows[0].n
    );
    await asUser(db, maria, () => db.query('select public.leave_group($1)', [groupId]));

    const stored = Number(
      (
        await db.query(
          'select count(*)::int as n from public.group_game_proposal_responses where proposal_id = $1 and user_id = $2',
          [proposal.id, maria]
        )
      ).rows[0].n
    );
    expect(stored).toBe(1);

    const after = parsePayload(
      (await asUser(db, andre, () => db.query('select public.get_group_game_proposal($1)', [proposal.id]))).rows[0]
    ).proposal;
    expect(after.counts.yes).toBe(1);
    expect(after.responses.map((row) => row.user_id)).toEqual([paulo]);
    expect(after.counts.unanswered).toBe(membersBefore - 1 - 1);
  });

  it('unique violation não relacionada a join_code não é mascarada', async () => {
    await db.exec(
      "create unique index if not exists scheduling_test_session_name on public.sessions (name) where name = 'Nome colide'"
    );
    const first = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Nome colide',
            proposalStart,
            proposalEnd,
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    const firstConfirmed = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.confirm_group_game_proposal($1, $2)', [first.id, first.version])
        )
      ).rows[0]
    );
    await asUser(db, andre, () =>
      db.query('select public.create_session_from_group_proposal($1, $2, 2, 2)', [
        first.id,
        firstConfirmed.version,
      ])
    );

    const second = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.create_group_game_proposal($1, $2, $3, $4, $5, $6, $7)', [
            groupId,
            'Nome colide',
            '2026-10-04T21:00:00.000Z',
            '2026-10-04T23:00:00.000Z',
            null,
            null,
            null,
          ])
        )
      ).rows[0]
    );
    const secondConfirmed = parsePayload(
      (
        await asUser(db, andre, () =>
          db.query('select public.confirm_group_game_proposal($1, $2)', [second.id, second.version])
        )
      ).rows[0]
    );

    let convertedError = null;
    try {
      await asUser(db, andre, () =>
        db.query('select public.create_session_from_group_proposal($1, $2, 2, 2)', [
          second.id,
          secondConfirmed.version,
        ])
      );
    } catch (error) {
      convertedError = error;
    }
    expect(convertedError).toBeTruthy();
    expect(String(convertedError?.message ?? convertedError)).toMatch(/unique|duplicate|23505/i);
    expect(String(convertedError?.message ?? convertedError)).not.toMatch(/JOIN_CODE_GENERATION_FAILED/);

    await db.exec('drop index if exists scheduling_test_session_name');
  });
});
