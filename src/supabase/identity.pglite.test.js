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

describe('identidade e read model de desempenho', () => {
  let db;
  let owner;
  let member;
  let otherMember;
  let outsider;
  let sessionId;
  let playerTarget;
  let playerOther;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(preludeSql);
    await db.exec(etapa1Sql);
    await db.exec(etapa2Sql);
    await db.exec(etapa3Sql);
    await db.exec(etapa4Sql);
    await db.exec(etapa5Sql);

    owner = crypto.randomUUID();
    member = crypto.randomUUID();
    otherMember = crypto.randomUUID();
    outsider = crypto.randomUUID();

    await insertUser(db, owner, 'owner@test.com', 'Dona');
    await insertUser(db, member, 'member@test.com', 'Membro');
    await insertUser(db, otherMember, 'other@test.com', 'Outro');
    await insertUser(db, outsider, 'out@test.com', 'De fora');

    sessionId = (
      await asUser(db, owner, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Sessão identidade', 2, 2)
           returning id, join_code`,
          [owner]
        )
      )
    ).rows[0];

    const joinCode = sessionId.join_code;
    sessionId = sessionId.id;

    await asUser(db, member, () =>
      db.query('select public.join_session_by_code($1) as id', [joinCode.toLowerCase()])
    );
    await asUser(db, otherMember, () =>
      db.query('select public.join_session_by_code($1) as id', [joinCode.toLowerCase()])
    );

    playerTarget = (
      await asUser(db, owner, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Alvo', $1, 3, 'M', 'short')
           returning id`,
          [owner]
        )
      )
    ).rows[0].id;

    playerOther = (
      await asUser(db, owner, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Reserva', $1, 3, 'F', 'short')
           returning id`,
          [owner]
        )
      )
    ).rows[0].id;

    await asUser(db, owner, async () => {
      await db.query('select public.add_session_player($1, $2, $3, 0)', [
        sessionId,
        playerTarget,
        'Alvo',
      ]);
      await db.query('select public.add_session_player($1, $2, $3, 1)', [
        sessionId,
        playerOther,
        'Reserva',
      ]);
    });
  }, 60000);

  afterAll(async () => {
    await db?.close?.();
  });

  it('cria índices parciais de claim e o índice de match_players(player_id, match_id)', async () => {
    const indexes = await db.query(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'player_link_claims_pending_player_claimant_idx',
           'player_link_claims_pending_claimant_idx',
           'match_players_player_id_match_id_idx'
         )
       order by indexname`
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'match_players_player_id_match_id_idx',
      'player_link_claims_pending_claimant_idx',
      'player_link_claims_pending_player_claimant_idx',
    ]);
  });

  it('create_and_link_player vincula na mesma linha e bloqueia segunda identidade', async () => {
    const created = await asUser(db, outsider, () =>
      db.query('select * from public.create_and_link_player($1)', ['Forasteiro'])
    );
    expect(created.rows[0].linked_user_id).toBe(outsider);
    expect(created.rows[0].created_by).toBe(outsider);

    await expect(
      asUser(db, outsider, () => db.query('select * from public.create_and_link_player($1)', ['Outro']))
    ).rejects.toThrow(/USER_ALREADY_LINKED/);
  });

  it('não permite dois claims pending do mesmo claimant', async () => {
    const first = await asUser(db, member, () =>
      db.query('select * from public.request_player_link_claim($1)', [playerTarget])
    );
    expect(first.rows[0].status).toBe('pending');

    await expect(
      asUser(db, member, () =>
        db.query('select * from public.request_player_link_claim($1)', [playerOther])
      )
    ).rejects.toThrow(/PLAYER_CLAIM_DUPLICATE/);
  });

  it('aprova em uma transação: vincula, marca aprovado e rejeita os outros pendentes do player', async () => {
    const second = await asUser(db, otherMember, () =>
      db.query('select * from public.request_player_link_claim($1)', [playerTarget])
    );
    const firstId = (
      await db.query(
        `select id from public.player_link_claims
         where player_id = $1 and claimant_user_id = $2 and status = 'pending'`,
        [playerTarget, member]
      )
    ).rows[0].id;

    const approved = await asUser(db, owner, () =>
      db.query('select * from public.approve_player_link_claim($1)', [firstId])
    );
    expect(approved.rows[0].status).toBe('approved');

    const player = (
      await db.query('select linked_user_id from public.players where id = $1', [playerTarget])
    ).rows[0];
    expect(player.linked_user_id).toBe(member);

    const claims = await db.query(
      `select claimant_user_id, status from public.player_link_claims
       where player_id = $1 order by claimant_user_id`,
      [playerTarget]
    );
    const byUser = Object.fromEntries(
      claims.rows.map((row) => [row.claimant_user_id, row.status])
    );
    expect(byUser[member]).toBe('approved');
    expect(byUser[otherMember]).toBe('rejected');
    expect(second.rows[0].id).toBeTruthy();
  });

  it('get_my_performance_matches devolve as partidas do jogador vinculado numa única RPC', async () => {
    const teamA = crypto.randomUUID();
    const teamB = crypto.randomUUID();
    const roundId = crypto.randomUUID();
    const matchId = crypto.randomUUID();
    const version = Number(
      (await db.query('select structure_version from public.sessions where id = $1', [sessionId]))
        .rows[0].structure_version
    );

    await asUser(db, owner, async () => {
      await db.query('select public.replace_session_teams($1, $2, $3::jsonb)', [
        sessionId,
        version,
        JSON.stringify([
          {
            id: teamA,
            name: 'A',
            sort_index: 0,
            members: [{ player_id: playerTarget, player_name_snapshot: 'Alvo' }],
          },
          {
            id: teamB,
            name: 'B',
            sort_index: 1,
            members: [{ player_id: playerOther, player_name_snapshot: 'Reserva' }],
          },
        ]),
      ]);
      const afterTeams = Number(
        (await db.query('select structure_version from public.sessions where id = $1', [sessionId]))
          .rows[0].structure_version
      );
      await db.query('select public.apply_session_rounds($1, $2, $3, $4::jsonb, 1)', [
        sessionId,
        afterTeams,
        'replace',
        JSON.stringify([
          {
            id: roundId,
            number: 1,
            cycle_number: 2,
            bye_team_id: null,
            matches: [
              {
                id: matchId,
                team_a_id: teamA,
                team_b_id: teamB,
                lineup_a: [{ player_id: playerTarget, player_name_snapshot: 'Alvo', sort_index: 0 }],
                lineup_b: [
                  { player_id: playerOther, player_name_snapshot: 'Reserva', sort_index: 0 },
                ],
              },
            ],
          },
        ]),
      ]);
    });

    const matchVersion = (
      await db.query('select version from public.matches where id = $1', [matchId])
    ).rows[0].version;
    await asUser(db, owner, () =>
      db.query('select * from public.set_match_score($1, 21, 18, $2)', [matchId, matchVersion])
    );

    const payload = (
      await asUser(db, member, () =>
        db.query('select public.get_my_performance_matches() as payload')
      )
    ).rows[0].payload;
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    expect(parsed.player.id).toBe(playerTarget);
    expect(parsed.matches).toHaveLength(1);
    expect(parsed.matches[0]).toMatchObject({
      match_id: matchId,
      session_id: sessionId,
      cycle_number: 2,
      score_a: 21,
      score_b: 18,
    });
    expect(parsed.matches[0].lineup_a[0]).toMatchObject({
      player_id: playerTarget,
      player_name_snapshot: 'Alvo',
    });
    expect(parsed.matches[0]).not.toHaveProperty('sourceType');

    await expect(
      asUser(db, otherMember, () => db.query('select public.get_my_performance_matches() as payload'))
    ).rejects.toThrow(/PLAYER_NOT_LINKED/);
  });
}, 60000);
