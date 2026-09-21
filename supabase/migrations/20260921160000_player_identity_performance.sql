-- Identidade user↔player, claims e read model de desempenho (etapa 3).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists legacy_source_id text;

do $legacy$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_legacy_source_id_key'
  ) then
    alter table public.sessions
      add constraint sessions_legacy_source_id_key unique (legacy_source_id);
  end if;
end;
$legacy$;

alter table public.player_link_claims
  add column if not exists decided_by uuid references public.profiles (id),
  add column if not exists decided_at timestamptz;

alter table public.player_link_claims
  drop constraint if exists player_link_claims_player_id_claimant_user_id_key;

create unique index if not exists player_link_claims_pending_player_claimant_idx
  on public.player_link_claims (player_id, claimant_user_id)
  where status = 'pending';

create unique index if not exists player_link_claims_pending_claimant_idx
  on public.player_link_claims (claimant_user_id)
  where status = 'pending';

create index if not exists match_players_player_id_match_id_idx
  on public.match_players (player_id, match_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.reject_pending_claims(
  p_player_id uuid,
  p_claimant_user_id uuid,
  p_except_claim_id uuid,
  p_decided_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_link_claims
  set
    status = 'rejected',
    decided_by = p_decided_by,
    decided_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where status = 'pending'
    and id is distinct from p_except_claim_id
    and (
      player_id = p_player_id
      or claimant_user_id = p_claimant_user_id
    );
end;
$$;

revoke all on function private.reject_pending_claims(uuid, uuid, uuid, uuid) from public;
revoke all on function private.reject_pending_claims(uuid, uuid, uuid, uuid) from anon;
revoke all on function private.reject_pending_claims(uuid, uuid, uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Identity RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_and_link_player(p_name text default null)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_player public.players;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('create_and_link_player:' || v_uid::text));

  if exists (
    select 1 from public.players p
    where p.linked_user_id = v_uid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'USER_ALREADY_LINKED';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    select pg_catalog.btrim(pr.display_name) into v_name
    from public.profiles pr
    where pr.id = v_uid;
  end if;
  v_name := coalesce(nullif(v_name, ''), '');
  if v_name = '' then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_NAME_REQUIRED';
  end if;

  perform set_config('private.allow_player_link', 'true', true);

  insert into public.players (name, created_by, linked_user_id, skill_score, gender, height)
  values (v_name, v_uid, v_uid, 3, 'F', 'short')
  returning * into v_player;

  return v_player;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'USER_ALREADY_LINKED';
end;
$$;

create or replace function public.request_player_link_claim(p_player_id uuid)
returns public.player_link_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players;
  v_claim public.player_link_claims;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if exists (
    select 1 from public.players p
    where p.linked_user_id = v_uid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'USER_ALREADY_LINKED';
  end if;

  select * into v_player
  from public.players
  where id = p_player_id
  for update;

  if v_player.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_NOT_FOUND';
  end if;

  if v_player.linked_user_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_ALREADY_LINKED';
  end if;

  if v_player.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_ARCHIVED';
  end if;

  if v_player.created_by is not distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'PLAYER_LINK_REQUIRES_OWNERSHIP';
  end if;

  if not private.player_visible_to_me(p_player_id) then
    raise exception using
      errcode = '42501',
      message = 'PLAYER_CLAIM_NOT_VISIBLE';
  end if;

  if exists (
    select 1 from public.player_link_claims c
    where c.status = 'pending'
      and (c.claimant_user_id = v_uid or (c.player_id = p_player_id and c.claimant_user_id = v_uid))
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_CLAIM_DUPLICATE';
  end if;

  insert into public.player_link_claims (player_id, claimant_user_id, status)
  values (p_player_id, v_uid, 'pending')
  returning * into v_claim;

  return v_claim;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_CLAIM_DUPLICATE';
end;
$$;

create or replace function public.approve_player_link_claim(p_claim_id uuid)
returns public.player_link_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.player_link_claims;
  v_player public.players;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_claim
  from public.player_link_claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_CLAIM_NOT_FOUND';
  end if;

  if v_claim.status is distinct from 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_CLAIM_NOT_PENDING';
  end if;

  select * into v_player
  from public.players
  where id = v_claim.player_id
  for update;

  if v_player.created_by is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'PLAYER_CLAIM_FORBIDDEN';
  end if;

  if v_player.linked_user_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_ALREADY_LINKED';
  end if;

  if exists (
    select 1 from public.players p
    where p.linked_user_id = v_claim.claimant_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'USER_ALREADY_LINKED';
  end if;

  perform set_config('private.allow_player_link', 'true', true);

  update public.players
  set linked_user_id = v_claim.claimant_user_id
  where id = v_player.id;

  update public.player_link_claims
  set
    status = 'approved',
    decided_by = v_uid,
    decided_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where id = v_claim.id
  returning * into v_claim;

  perform private.reject_pending_claims(
    v_player.id,
    v_claim.claimant_user_id,
    v_claim.id,
    v_uid
  );

  return v_claim;
end;
$$;

create or replace function public.reject_player_link_claim(p_claim_id uuid)
returns public.player_link_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.player_link_claims;
  v_player public.players;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_claim
  from public.player_link_claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_CLAIM_NOT_FOUND';
  end if;

  if v_claim.status is distinct from 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_CLAIM_NOT_PENDING';
  end if;

  select * into v_player
  from public.players
  where id = v_claim.player_id
  for update;

  if v_player.created_by is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'PLAYER_CLAIM_FORBIDDEN';
  end if;

  update public.player_link_claims
  set
    status = 'rejected',
    decided_by = v_uid,
    decided_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where id = v_claim.id
  returning * into v_claim;

  return v_claim;
end;
$$;

create or replace function public.list_claimable_players()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'created_by', p.created_by
      ) order by p.name, p.id)
      from public.players p
      where p.linked_user_id is null
        and p.archived_at is null
        and p.created_by is distinct from v_uid
        and private.player_visible_to_me(p.id)
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.list_my_player_link_claims()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  return jsonb_build_object(
    'mine',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', c.id,
          'player_id', c.player_id,
          'player_name', p.name,
          'claimant_user_id', c.claimant_user_id,
          'status', c.status,
          'created_at', c.created_at,
          'decided_at', c.decided_at
        ) order by c.created_at desc)
        from public.player_link_claims c
        join public.players p on p.id = c.player_id
        where c.claimant_user_id = v_uid
      ),
      '[]'::jsonb
    ),
    'inbox',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', c.id,
          'player_id', c.player_id,
          'player_name', p.name,
          'claimant_user_id', c.claimant_user_id,
          'claimant_display_name', coalesce(pr.display_name, ''),
          'status', c.status,
          'created_at', c.created_at,
          'decided_at', c.decided_at
        ) order by c.created_at desc)
        from public.player_link_claims c
        join public.players p on p.id = c.player_id
        left join public.profiles pr on pr.id = c.claimant_user_id
        where p.created_by = v_uid
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Performance read model (no stats in SQL)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_performance_matches()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_player
  from public.players
  where linked_user_id = v_uid;

  if v_player.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_NOT_LINKED';
  end if;

  return jsonb_build_object(
    'player',
    jsonb_build_object(
      'id', v_player.id,
      'name', v_player.name,
      'archived_at', v_player.archived_at,
      'created_by', v_player.created_by
    ),
    'matches',
    coalesce(
      (
        select jsonb_agg(payload order by sort_date desc, session_id, cycle_number, round_number, match_id)
        from (
          select
            s.date as sort_date,
            s.id as session_id,
            r.cycle_number,
            r.number as round_number,
            m.id as match_id,
            jsonb_build_object(
              'match_id', m.id,
              'session_id', s.id,
              'session_name', s.name,
              'session_date', s.date,
              'session_updated_at', s.updated_at,
              'session_created_at', s.created_at,
              'legacy_source_id', s.legacy_source_id,
              'round_id', r.id,
              'round_number', r.number,
              'cycle_number', r.cycle_number,
              'score_a', m.score_a,
              'score_b', m.score_b,
              'lineup_a', coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'player_id', mp.player_id,
                    'player_name_snapshot', mp.player_name_snapshot,
                    'sort_index', mp.sort_index
                  )
                  order by mp.sort_index, mp.player_id
                ) filter (where mp.side = 'a'),
                '[]'::jsonb
              ),
              'lineup_b', coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'player_id', mp.player_id,
                    'player_name_snapshot', mp.player_name_snapshot,
                    'sort_index', mp.sort_index
                  )
                  order by mp.sort_index, mp.player_id
                ) filter (where mp.side = 'b'),
                '[]'::jsonb
              )
            ) as payload
          from public.matches m
          join public.rounds r on r.id = m.round_id
          join public.sessions s on s.id = m.session_id
          join public.match_players mp on mp.match_id = m.id
          where exists (
            select 1
            from public.match_players mine
            where mine.player_id = v_player.id
              and mine.match_id = m.id
          )
          group by
            m.id,
            m.score_a,
            m.score_b,
            s.id,
            s.date,
            s.name,
            s.updated_at,
            s.created_at,
            s.legacy_source_id,
            r.id,
            r.number,
            r.cycle_number
        ) grouped
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- The EXISTS uses match_players(player_id, match_id). Lineups are aggregated once
-- per match in the same statement; the client never loops SELECT match_players.

revoke all on function public.create_and_link_player(text) from public;
revoke all on function public.create_and_link_player(text) from anon;
revoke all on function public.request_player_link_claim(uuid) from public;
revoke all on function public.request_player_link_claim(uuid) from anon;
revoke all on function public.approve_player_link_claim(uuid) from public;
revoke all on function public.approve_player_link_claim(uuid) from anon;
revoke all on function public.reject_player_link_claim(uuid) from public;
revoke all on function public.reject_player_link_claim(uuid) from anon;
revoke all on function public.list_claimable_players() from public;
revoke all on function public.list_claimable_players() from anon;
revoke all on function public.list_my_player_link_claims() from public;
revoke all on function public.list_my_player_link_claims() from anon;
revoke all on function public.get_my_performance_matches() from public;
revoke all on function public.get_my_performance_matches() from anon;

grant execute on function public.create_and_link_player(text) to authenticated;
grant execute on function public.request_player_link_claim(uuid) to authenticated;
grant execute on function public.approve_player_link_claim(uuid) to authenticated;
grant execute on function public.reject_player_link_claim(uuid) to authenticated;
grant execute on function public.list_claimable_players() to authenticated;
grant execute on function public.list_my_player_link_claims() to authenticated;
grant execute on function public.get_my_performance_matches() to authenticated;
