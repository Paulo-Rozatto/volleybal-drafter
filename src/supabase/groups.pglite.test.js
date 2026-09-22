import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const preludeSql = readFileSync(join(root, 'supabase/tests/pglite_prelude.sql'), 'utf8');
const etapa1Sql = readFileSync(
  join(root, 'supabase/migrations/20260921120000_cloud_sessions.sql'),
  'utf8'
);
const etapa2Sql = readFileSync(
  join(root, 'supabase/migrations/20260921140000_cloud_sessions_etapa2.sql'),
  'utf8'
);
const etapa3Sql = readFileSync(
  join(root, 'supabase/migrations/20260921160000_player_identity_performance.sql'),
  'utf8'
);
const etapa4Sql = readFileSync(
  join(root, 'supabase/migrations/20260921180000_cloud_groups.sql'),
  'utf8'
);
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
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    await db.exec('set local role authenticated');
    const result = await run();
    await db.exec('commit');
    return result;
  } catch (error) {
    try {
      await db.exec('rollback');
    } catch {
      // The failed statement already aborted the transaction.
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

describe('cloud groups RLS', () => {
  let db;
  let andre;
  let paulo;
  let davi;
  let outsider;
  let groupId;
  let joinCode;
  let standaloneSessionId;

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

    const created = await asUser(db, andre, () =>
      db.query('select * from public.create_group($1, $2)', ['Vôlei Quinta', 'Pelada'])
    );
    groupId = created.rows[0].id;
    joinCode = created.rows[0].join_code;

    standaloneSessionId = (
      await asUser(db, andre, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Avulso', 2, 2)
           returning id`,
          [andre]
        )
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await db?.close?.();
  });

  it('cria grupo e torna o criador owner', async () => {
    const membership = await asUser(db, andre, () =>
      db.query('select role from public.group_members where group_id = $1 and user_id = $2', [
        groupId,
        andre,
      ])
    );
    expect(membership.rows[0].role).toBe('owner');
  });

  it('segundo usuário entra pelo código como member', async () => {
    const joined = await asUser(db, paulo, () =>
      db.query('select public.join_group_by_code($1) as id', [joinCode.toLowerCase()])
    );
    expect(joined.rows[0].id).toBe(groupId);
    const role = await asUser(db, paulo, () =>
      db.query('select role from public.group_members where group_id = $1 and user_id = $2', [
        groupId,
        paulo,
      ])
    );
    expect(role.rows[0].role).toBe('member');
  });

  it('entrar no grupo não cria session_member nem session_player', async () => {
    const members = await db.query(
      'select count(*)::int as n from public.session_members where user_id = $1',
      [paulo]
    );
    const players = await db.query(
      'select count(*)::int as n from public.session_players where player_id in (select id from public.players where linked_user_id = $1)',
      [paulo]
    );
    expect(members.rows[0].n).toBe(0);
    expect(players.rows[0].n).toBe(0);
  });

  it('usuário externo não lê o grupo', async () => {
    const rows = await asUser(db, outsider, () =>
      db.query('select id from public.groups where id = $1', [groupId])
    );
    expect(rows.rows).toHaveLength(0);
    const memberRows = await asUser(db, outsider, () =>
      db.query('select user_id from public.group_members where group_id = $1', [groupId])
    );
    expect(memberRows.rows).toHaveLength(0);
  });

  it('member lê grupo e membros', async () => {
    const group = await asUser(db, paulo, () =>
      db.query('select name from public.groups where id = $1', [groupId])
    );
    expect(group.rows[0].name).toBe('Vôlei Quinta');
    const members = await asUser(db, paulo, () =>
      db.query('select user_id, role from public.group_members where group_id = $1', [groupId])
    );
    expect(members.rows).toHaveLength(2);
  });

  it('member não promove ninguém', async () => {
    await expect(
      asUser(db, paulo, () =>
        db.query('select public.set_group_member_role($1, $2, $3)', [groupId, paulo, 'admin'])
      )
    ).rejects.toThrow(/GROUP_FORBIDDEN|GROUP_ROLE_FORBIDDEN/);
  });

  it('admin promove member e não altera owner', async () => {
    await asUser(db, davi, () => db.query('select public.join_group_by_code($1)', [joinCode]));
    await asUser(db, andre, () =>
      db.query('select public.set_group_member_role($1, $2, $3)', [groupId, paulo, 'admin'])
    );
    const pauloRole = await asUser(db, andre, () =>
      db.query('select role from public.group_members where group_id = $1 and user_id = $2', [
        groupId,
        paulo,
      ])
    );
    expect(pauloRole.rows[0].role).toBe('admin');

    await asUser(db, paulo, () =>
      db.query('select public.set_group_member_role($1, $2, $3)', [groupId, davi, 'admin'])
    );
    const daviRole = await asUser(db, andre, () =>
      db.query('select role from public.group_members where group_id = $1 and user_id = $2', [
        groupId,
        davi,
      ])
    );
    expect(daviRole.rows[0].role).toBe('admin');

    await expect(
      asUser(db, paulo, () =>
        db.query('select public.set_group_member_role($1, $2, $3)', [groupId, andre, 'member'])
      )
    ).rejects.toThrow(/GROUP_OWNER_IMMUTABLE/);
  });

  it('member pode sair do grupo', async () => {
    await asUser(db, paulo, () =>
      db.query('select public.set_group_member_role($1, $2, $3)', [groupId, davi, 'member'])
    );
    await asUser(db, davi, () => db.query('select public.leave_group($1)', [groupId]));
    const gone = await asUser(db, andre, () =>
      db.query('select 1 from public.group_members where group_id = $1 and user_id = $2', [
        groupId,
        davi,
      ])
    );
    expect(gone.rows).toHaveLength(0);
  });

  it('não remove o último owner', async () => {
    await expect(
      asUser(db, andre, () => db.query('select public.leave_group($1)', [groupId]))
    ).rejects.toThrow(/GROUP_LAST_OWNER/);
    await expect(
      asUser(db, paulo, () => db.query('select public.remove_group_member($1, $2)', [groupId, andre]))
    ).rejects.toThrow(/GROUP_OWNER_IMMUTABLE/);
  });

  it('rotate join code invalida o código antigo', async () => {
    const rotated = await asUser(db, andre, () =>
      db.query('select public.rotate_group_join_code($1) as code', [groupId])
    );
    const nextCode = rotated.rows[0].code;
    expect(nextCode).not.toBe(joinCode);

    await expect(
      asUser(db, davi, () => db.query('select public.join_group_by_code($1)', [joinCode]))
    ).rejects.toThrow(/GROUP_JOIN_CODE_NOT_FOUND/);

    await asUser(db, davi, () => db.query('select public.join_group_by_code($1)', [nextCode]));
    joinCode = nextCode;
  });

  it('session com group_id null continua válida', async () => {
    const row = await asUser(db, andre, () =>
      db.query('select group_id, created_by from public.sessions where id = $1', [standaloneSessionId])
    );
    expect(row.rows[0].group_id).toBeNull();
    expect(row.rows[0].created_by).toBe(andre);
  });

  it('criar session no grupo exige membership e só o criador vira session owner', async () => {
    const created = await asUser(db, andre, () =>
      db.query(
        `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
         values ($1, '2026-09-21', 'Quinta', 2, 2, $2)
         returning id`,
        [andre, groupId]
      )
    );
    const sessionId = created.rows[0].id;
    const members = await db.query(
      'select user_id, role from public.session_members where session_id = $1',
      [sessionId]
    );
    expect(members.rows).toHaveLength(1);
    expect(members.rows[0].user_id).toBe(andre);
    expect(members.rows[0].role).toBe('owner');

    const pauloAccess = await asUser(db, paulo, () =>
      db.query('select id from public.sessions where id = $1', [sessionId])
    );
    expect(pauloAccess.rows).toHaveLength(0);
  });

  it('quem não pertence ao grupo não cria session com aquele group_id', async () => {
    await expect(
      asUser(db, outsider, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count, group_id)
           values ($1, '2026-09-21', 'Invasão', 2, 2, $2)`,
          [outsider, groupId]
        )
      )
    ).rejects.toThrow(/row-level security|42501|policy/i);
  });

  it('join_group_by_code rejeita código inexistente', async () => {
    await expect(
      asUser(db, andre, () => db.query("select public.join_group_by_code('ZZZZZZZZ')"))
    ).rejects.toThrow(/GROUP_JOIN_CODE_NOT_FOUND/);
  });
});
