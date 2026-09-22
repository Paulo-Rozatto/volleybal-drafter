import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const preludeSql = readFileSync(join(root, 'supabase/tests/pglite_prelude.sql'), 'utf8');
const migrationSql = readFileSync(
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

describe('cloud sessions RLS', () => {
  let db;
  let ownerA;
  let memberA;
  let viewerA;
  let ownerB;
  let outsider;
  let sessionA;
  let sessionB;
  let teamA1;
  let teamA2;
  let teamB1;
  let teamB2;
  let roundA;
  let roundB;
  let matchA;
  let playerJoao;
  let playerAna;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(preludeSql);
    await db.exec(migrationSql);
    await db.exec(etapa2Sql);
    await db.exec(etapa3Sql);
    await db.exec(etapa4Sql);
    await db.exec(etapa5Sql);
    await db.exec(etapa6Sql);

    ownerA = crypto.randomUUID();
    memberA = crypto.randomUUID();
    viewerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    outsider = crypto.randomUUID();

    for (const [id, email, name] of [
      [ownerA, 'owner-a@test.com', 'Dona A'],
      [memberA, 'member-a@test.com', 'Membro A'],
      [viewerA, 'viewer-a@test.com', 'Viewer A'],
      [ownerB, 'owner-b@test.com', 'Dona B'],
      [outsider, 'outsider@test.com', 'De fora'],
    ]) {
      await db.query(
        'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)',
        [id, email, JSON.stringify({ display_name: name })]
      );
    }

    sessionA = (
      await asUser(db, ownerA, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Sessão A', 2, 2)
           returning id, join_code`,
          [ownerA]
        )
      )
    ).rows[0];

    sessionB = (
      await asUser(db, ownerB, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Sessão B', 2, 2)
           returning id, join_code`,
          [ownerB]
        )
      )
    ).rows[0];

    await asUser(db, memberA, () =>
      db.query('select public.join_session_by_code($1) as id', [sessionA.join_code.toLowerCase()])
    );

    await db.query(
      `insert into public.session_members (session_id, user_id, role)
       values ($1, $2, 'viewer')`,
      [sessionA.id, viewerA]
    );

    const players = await asUser(db, ownerA, () =>
      db.query(
        `insert into public.players (name, created_by, skill_score, gender, height)
         values ('João', $1, 3, 'M', 'short'), ('Ana', $1, 3, 'F', 'short')
         returning id, name`,
        [ownerA]
      )
    );
    playerJoao = players.rows.find((row) => row.name === 'João').id;
    playerAna = players.rows.find((row) => row.name === 'Ana').id;

    const playerB = (
      await asUser(db, ownerB, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Bia', $1, 3, 'F', 'short'), ('Caio', $1, 3, 'M', 'short')
           returning id, name`,
          [ownerB]
        )
      )
    ).rows;
    const playerBia = playerB.find((row) => row.name === 'Bia').id;
    const playerCaio = playerB.find((row) => row.name === 'Caio').id;

    teamA1 = crypto.randomUUID();
    teamA2 = crypto.randomUUID();
    teamB1 = crypto.randomUUID();
    teamB2 = crypto.randomUUID();
    roundA = crypto.randomUUID();
    roundB = crypto.randomUUID();
    const matchAId = crypto.randomUUID();

    await asUser(db, ownerA, async () => {
      await db.query('select public.add_session_player($1, $2, $3, 0)', [
        sessionA.id,
        playerJoao,
        'João',
      ]);
      await db.query('select public.add_session_player($1, $2, $3, 1)', [
        sessionA.id,
        playerAna,
        'Ana',
      ]);
      await db.query('select public.replace_session_teams($1, 2, $2::jsonb)', [
        sessionA.id,
        JSON.stringify([
          {
            id: teamA1,
            name: 'A1',
            sort_index: 0,
            members: [{ player_id: playerJoao, player_name_snapshot: 'João' }],
          },
          {
            id: teamA2,
            name: 'A2',
            sort_index: 1,
            members: [{ player_id: playerAna, player_name_snapshot: 'Ana' }],
          },
        ]),
      ]);
      await db.query('select public.apply_session_rounds($1, 3, $2, $3::jsonb, 1)', [
        sessionA.id,
        'replace',
        JSON.stringify([
          {
            id: roundA,
            number: 1,
            cycle_number: 1,
            bye_team_id: null,
            matches: [
              {
                id: matchAId,
                team_a_id: teamA1,
                team_b_id: teamA2,
                lineup_a: [{ player_id: playerJoao, player_name_snapshot: 'João', sort_index: 0 }],
                lineup_b: [{ player_id: playerAna, player_name_snapshot: 'Ana', sort_index: 0 }],
              },
            ],
          },
        ]),
      ]);
    });

    await asUser(db, ownerB, async () => {
      await db.query('select public.add_session_player($1, $2, $3, 0)', [
        sessionB.id,
        playerBia,
        'Bia',
      ]);
      await db.query('select public.add_session_player($1, $2, $3, 1)', [
        sessionB.id,
        playerCaio,
        'Caio',
      ]);
      await db.query('select public.replace_session_teams($1, 2, $2::jsonb)', [
        sessionB.id,
        JSON.stringify([
          {
            id: teamB1,
            name: 'B1',
            sort_index: 0,
            members: [{ player_id: playerBia, player_name_snapshot: 'Bia' }],
          },
          {
            id: teamB2,
            name: 'B2',
            sort_index: 1,
            members: [{ player_id: playerCaio, player_name_snapshot: 'Caio' }],
          },
        ]),
      ]);
      await db.query('select public.apply_session_rounds($1, 3, $2, $3::jsonb, 1)', [
        sessionB.id,
        'replace',
        JSON.stringify([
          {
            id: roundB,
            number: 1,
            cycle_number: 1,
            bye_team_id: null,
            matches: [
              {
                id: crypto.randomUUID(),
                team_a_id: teamB1,
                team_b_id: teamB2,
                lineup_a: [{ player_id: playerBia, player_name_snapshot: 'Bia', sort_index: 0 }],
                lineup_b: [{ player_id: playerCaio, player_name_snapshot: 'Caio', sort_index: 0 }],
              },
            ],
          },
        ]),
      ]);
    });

    matchA = (await db.query('select id, version from public.matches where id = $1', [matchAId]))
      .rows[0];
  }, 60000);

  afterAll(async () => {
    await db?.close?.();
  });

  it('membro de sessão A não lê sessão B', async () => {
    const visible = await asUser(db, memberA, () =>
      db.query('select id, name from public.sessions order by name')
    );
    expect(visible.rows.map((row) => row.name)).toEqual(['Sessão A']);
  });

  it('join code é case-normalized e idempotente', async () => {
    const again = await asUser(db, memberA, () =>
      db.query('select public.join_session_by_code($1) as id', [sessionA.join_code.toLowerCase()])
    );
    expect(again.rows[0].id).toBe(sessionA.id);
    const stored = await db.query('select join_code from public.sessions where id = $1', [
      sessionA.id,
    ]);
    expect(stored.rows[0].join_code).toBe(sessionA.join_code.toUpperCase());
  });

  it('viewer não grava placar', async () => {
    await expect(
      asUser(db, viewerA, () =>
        db.query('select * from public.set_match_score($1, 21, 18, $2)', [matchA.id, matchA.version])
      )
    ).rejects.toThrow(/SCORE_FORBIDDEN/);
  });

  it('member grava somente placar via RPC e incrementa version', async () => {
    const scored = await asUser(db, memberA, () =>
      db.query('select * from public.set_match_score($1, 21, 18, $2)', [matchA.id, matchA.version])
    );
    expect(scored.rows[0].score_a).toBe(21);
    expect(scored.rows[0].version).toBe(Number(matchA.version) + 1);
    matchA.version = scored.rows[0].version;

    const events = await asUser(db, memberA, () =>
      db.query(
        `select event_type, old_score_a, new_score_a, match_version_before, match_version_after
         from public.match_events
         where match_id = $1
         order by created_at desc`,
        [matchA.id]
      )
    );
    expect(events.rows[0].event_type).toBe('set_score');
    expect(events.rows[0].new_score_a).toBe(21);
    expect(Number(events.rows[0].match_version_after)).toBe(Number(matchA.version));
    expect(Number(events.rows[0].match_version_before)).toBe(Number(matchA.version) - 1);
  });

  it('member não altera team_id/round_id', async () => {
    await expect(
      asUser(db, memberA, () =>
        db.query('update public.matches set team_a_id = $1 where id = $2 returning id', [
          teamA2,
          matchA.id,
        ])
      )
    ).rejects.toThrow(/permission denied|42501/i);
  });

  it('concorrência de version retorna conflito', async () => {
    await expect(
      asUser(db, memberA, () =>
        db.query('select * from public.set_match_score($1, 25, 18, $2)', [matchA.id, 0])
      )
    ).rejects.toThrow(/SCORE_VERSION_CONFLICT/);
  });

  it('mesmo jogador não entra em dois times-base', async () => {
    const extra = (
      await asUser(db, ownerA, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Sessão duplicata', 2, 2)
           returning id`,
          [ownerA]
        )
      )
    ).rows[0];
    const teamOne = crypto.randomUUID();
    const teamTwo = crypto.randomUUID();
    await asUser(db, ownerA, async () => {
      await db.query('select public.add_session_player($1, $2, $3, 0)', [
        extra.id,
        playerJoao,
        'João',
      ]);
    });
    await expect(
      asUser(db, ownerA, () =>
        db.query('select public.replace_session_teams($1, 1, $2::jsonb)', [
          extra.id,
          JSON.stringify([
            {
              id: teamOne,
              name: 'X',
              sort_index: 0,
              members: [{ player_id: playerJoao, player_name_snapshot: 'João' }],
            },
            {
              id: teamTwo,
              name: 'Y',
              sort_index: 1,
              members: [{ player_id: playerJoao, player_name_snapshot: 'João clone' }],
            },
          ]),
        ])
      )
    ).rejects.toThrow(/duplicate|unique|team_members/i);
  });

  it('team/round de outra session não pode ser referenciado por match', async () => {
    const version = Number(
      (await db.query('select structure_version from public.sessions where id = $1', [sessionA.id]))
        .rows[0].structure_version
    );
    await expect(
      asUser(db, ownerA, () =>
        db.query('select public.apply_session_rounds($1, $2, $3, $4::jsonb, 1)', [
          sessionA.id,
          version,
          'append',
          JSON.stringify([
            {
              id: crypto.randomUUID(),
              number: 99,
              cycle_number: 9,
              bye_team_id: teamB1,
              matches: [],
            },
          ]),
        ])
      )
    ).rejects.toThrow(/foreign key|violates/i);

    await expect(
      asUser(db, ownerA, () =>
        db.query('select public.apply_session_rounds($1, $2, $3, $4::jsonb, 1)', [
          sessionA.id,
          version,
          'append',
          JSON.stringify([
            {
              id: crypto.randomUUID(),
              number: 98,
              cycle_number: 8,
              bye_team_id: null,
              matches: [
                {
                  id: crypto.randomUUID(),
                  team_a_id: teamB1,
                  team_b_id: teamB2,
                  lineup_a: [],
                  lineup_b: [],
                },
              ],
            },
          ]),
        ])
      )
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('membro consegue ler display_name dos outros membros da mesma session', async () => {
    const names = await asUser(db, memberA, () =>
      db.query('select display_name from public.profiles order by display_name')
    );
    expect(names.rows.map((row) => row.display_name)).toEqual(['Dona A', 'Membro A', 'Viewer A']);
  });

  it('não membro não consegue ler profiles da sessão', async () => {
    const names = await asUser(db, outsider, () =>
      db.query('select display_name from public.profiles order by display_name')
    );
    expect(names.rows.map((row) => row.display_name)).toEqual(['De fora']);
  });

  it('player arquivado continua aparecendo nos snapshots antigos', async () => {
    await asUser(db, ownerA, () =>
      db.query(
        `update public.players
         set name = 'João Novo', archived_at = pg_catalog.now()
         where id = $1`,
        [playerJoao]
      )
    );

    const snapshot = await asUser(db, memberA, () =>
      db.query(
        `select mp.player_name_snapshot, p.name, p.archived_at
         from public.match_players mp
         join public.players p on p.id = mp.player_id
         where mp.match_id = $1 and mp.player_id = $2`,
        [matchA.id, playerJoao]
      )
    );
    expect(snapshot.rows[0].player_name_snapshot).toBe('João');
    expect(snapshot.rows[0].name).toBe('João Novo');
    expect(snapshot.rows[0].archived_at).toBeTruthy();

    await expect(
      asUser(db, ownerA, () =>
        db.query('delete from public.players where id = $1 returning id', [playerJoao])
      )
    ).rejects.toThrow(/permission denied|42501/i);
  });

  it('created_by não autoriza depois que o papel não é mais owner', async () => {
    await db.query(
      `update public.session_members set role = 'member' where session_id = $1 and user_id = $2`,
      [sessionB.id, ownerB]
    );
    await db.query(
      `insert into public.session_members (session_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict (session_id, user_id) do update set role = 'owner'`,
      [sessionB.id, ownerA]
    );

    await expect(
      asUser(db, ownerB, () =>
        db.query(
          `insert into public.teams (session_id, name, sort_index)
           values ($1, 'Não deveria', 9)
           returning id`,
          [sessionB.id]
        )
      )
    ).rejects.toThrow(/permission denied|42501|STRUCTURE/i);
  });

  it('persiste os IDs de times e rodadas enviados pelo cliente', async () => {
    const stored = await asUser(db, ownerA, () =>
      db.query('select id from public.teams where session_id = $1 order by sort_index', [
        sessionA.id,
      ])
    );
    expect(stored.rows.map((row) => row.id)).toEqual([teamA1, teamA2]);
    const rounds = await db.query('select id from public.rounds where session_id = $1', [
      sessionA.id,
    ]);
    expect(rounds.rows.map((row) => row.id)).toEqual([roundA]);
    expect(
      (await db.query('select id from public.matches where id = $1', [matchA.id])).rows
    ).toHaveLength(1);
  });

  it('link_player exige propriedade e não basta compartilhar a sessão', async () => {
    await expect(
      asUser(db, memberA, () => db.query('select * from public.link_player($1)', [playerJoao]))
    ).rejects.toThrow(/PLAYER_LINK_REQUIRES_OWNERSHIP/);

    const own = (
      await asUser(db, memberA, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Membro player', $1, 3, 'F', 'short')
           returning id`,
          [memberA]
        )
      )
    ).rows[0];
    const linked = await asUser(db, memberA, () =>
      db.query('select linked_user_id from public.link_player($1)', [own.id])
    );
    expect(linked.rows[0].linked_user_id).toBe(memberA);

    const sneaky = await asUser(db, memberA, () =>
      db.query(`update public.players set linked_user_id = $1 where id = $2 returning id`, [
        memberA,
        playerJoao,
      ])
    );
    expect(sneaky.rows).toHaveLength(0);
  });

  it('RPCs estruturais falham com conflito de structure_version', async () => {
    const extra = (
      await asUser(db, ownerA, () =>
        db.query(
          `insert into public.sessions (created_by, date, name, team_size, team_count)
           values ($1, '2026-09-21', 'Sessão versão', 2, 2)
           returning id`,
          [ownerA]
        )
      )
    ).rows[0];
    const fresh = (
      await asUser(db, ownerA, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Vera', $1, 3, 'F', 'short')
           returning id`,
          [ownerA]
        )
      )
    ).rows[0].id;
    await asUser(db, ownerA, () =>
      db.query('select public.add_session_player($1, $2, $3, 0)', [extra.id, fresh, 'Vera'])
    );
    await expect(
      asUser(db, ownerA, () =>
        db.query('select public.add_session_player($1, $2, $3, 0)', [extra.id, playerAna, 'Ana'])
      )
    ).rejects.toThrow(/STRUCTURE_VERSION_CONFLICT/);
  });

  it('não adiciona session_player fora de draft', async () => {
    const version = Number(
      (await db.query('select structure_version from public.sessions where id = $1', [sessionA.id]))
        .rows[0].structure_version
    );
    const extraPlayer = (
      await asUser(db, ownerA, () =>
        db.query(
          `insert into public.players (name, created_by, skill_score, gender, height)
           values ('Tardi', $1, 3, 'M', 'short')
           returning id`,
          [ownerA]
        )
      )
    ).rows[0].id;
    await expect(
      asUser(db, ownerA, () =>
        db.query('select public.add_session_player($1, $2, $3, $4)', [
          sessionA.id,
          extraPlayer,
          'Tardi',
          version,
        ])
      )
    ).rejects.toThrow(/SESSION_NOT_DRAFT/);
  });

  it('depois de finished, owner corrige placar e member/viewer não; limpeza é proibida', async () => {
    const version = Number(
      (await db.query('select structure_version from public.sessions where id = $1', [sessionA.id]))
        .rows[0].structure_version
    );
    await asUser(db, ownerA, () =>
      db.query('select public.finalize_session($1, $2)', [sessionA.id, version])
    );

    await expect(
      asUser(db, memberA, () =>
        db.query('select * from public.set_match_score($1, 25, 20, $2)', [matchA.id, matchA.version])
      )
    ).rejects.toThrow(/SCORE_FORBIDDEN/);

    await expect(
      asUser(db, viewerA, () =>
        db.query('select * from public.set_match_score($1, 25, 20, $2)', [matchA.id, matchA.version])
      )
    ).rejects.toThrow(/SCORE_FORBIDDEN/);

    const corrected = await asUser(db, ownerA, () =>
      db.query('select * from public.set_match_score($1, 25, 20, $2)', [matchA.id, matchA.version])
    );
    expect(corrected.rows[0].score_a).toBe(25);
    matchA.version = corrected.rows[0].version;

    await expect(
      asUser(db, ownerA, () =>
        db.query('select * from public.set_match_score($1, null, null, $2)', [
          matchA.id,
          matchA.version,
        ])
      )
    ).rejects.toThrow(/SCORE_CLEAR_FORBIDDEN/);
  });
}, 60000);
