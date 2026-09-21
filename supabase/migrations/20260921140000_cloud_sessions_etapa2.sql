-- Cloud sessions (etapa 2). Estrutura via RPC; IDs vêm do domínio JS.

-- ---------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists structure_version bigint not null default 0;

create table if not exists public.session_players (
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  player_name_snapshot text not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (session_id, player_id)
);

create table if not exists public.match_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  match_id uuid not null,
  user_id uuid references public.profiles (id),
  event_type text not null check (event_type in ('set_score', 'clear_score')),
  old_score_a integer,
  old_score_b integer,
  new_score_a integer,
  new_score_b integer,
  match_version_before bigint not null,
  match_version_after bigint not null,
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (match_id, session_id)
    references public.matches (id, session_id) on delete cascade
);

create table if not exists public.player_link_claims (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  claimant_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (player_id, claimant_user_id)
);

insert into public.session_players (session_id, player_id, player_name_snapshot)
select tm.session_id, tm.player_id, tm.player_name_snapshot
from public.team_members tm
on conflict (session_id, player_id) do nothing;

alter table public.match_players
  add column if not exists session_id uuid;

update public.match_players mp
set session_id = m.session_id
from public.matches m
where m.id = mp.match_id
  and mp.session_id is null;

insert into public.session_players (session_id, player_id, player_name_snapshot)
select mp.session_id, mp.player_id, mp.player_name_snapshot
from public.match_players mp
where mp.session_id is not null
on conflict (session_id, player_id) do nothing;

alter table public.match_players
  alter column session_id set not null;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'team_members_session_player_fk'
  ) then
    alter table public.team_members
      add constraint team_members_session_player_fk
      foreign key (session_id, player_id)
      references public.session_players (session_id, player_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'match_players_session_fk'
  ) then
    alter table public.match_players
      add constraint match_players_session_fk
      foreign key (match_id, session_id)
      references public.matches (id, session_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'match_players_session_player_fk'
  ) then
    alter table public.match_players
      add constraint match_players_session_player_fk
      foreign key (session_id, player_id)
      references public.session_players (session_id, player_id)
      on delete restrict;
  end if;
end;
$fk$;

create index if not exists session_players_player_id_idx
  on public.session_players (player_id);
create index if not exists match_events_session_id_idx
  on public.match_events (session_id);
create index if not exists match_events_match_id_idx
  on public.match_events (match_id);
create index if not exists match_players_session_id_idx
  on public.match_players (session_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.player_visible_to_me(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        p.created_by = auth.uid()
        or p.linked_user_id = auth.uid()
        or exists (
          select 1
          from public.session_players sp
          inner join public.session_members sm on sm.session_id = sp.session_id
          where sp.player_id = p.id
            and sm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.team_members tm
          inner join public.session_members sm on sm.session_id = tm.session_id
          where tm.player_id = p.id
            and sm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.match_players mp
          inner join public.matches m on m.id = mp.match_id
          inner join public.session_members sm on sm.session_id = m.session_id
          where mp.player_id = p.id
            and sm.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function private.protect_session_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception using
      errcode = 'P0001',
      message = 'CREATED_BY_IMMUTABLE';
  end if;

  if new.join_code is distinct from old.join_code
     and current_setting('private.allow_join_code_rotate', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'JOIN_CODE_ROTATE_REQUIRED';
  end if;

  if new.status is distinct from old.status
     and current_setting('private.allow_status_write', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'STATUS_IMMUTABLE';
  end if;

  if new.structure_version is distinct from old.structure_version
     and current_setting('private.allow_structure_write', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'USE_STRUCTURE_RPC';
  end if;

  return new;
end;
$$;

create or replace function private.protect_player_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.linked_user_id is not null
     and current_setting('private.allow_player_link', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'USE_LINK_PLAYER';
  end if;

  if tg_op = 'UPDATE'
     and new.linked_user_id is distinct from old.linked_user_id
     and current_setting('private.allow_player_link', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'USE_LINK_PLAYER';
  end if;

  return new;
end;
$$;

drop trigger if exists players_protect_link on public.players;
create trigger players_protect_link
  before insert or update on public.players
  for each row execute function private.protect_player_link();

create or replace function private.lock_session_structure(
  p_session_id uuid,
  p_expected_structure_version bigint
)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'SESSION_NOT_FOUND';
  end if;

  if not private.can_manage_session(p_session_id) then
    raise exception using
      errcode = '42501',
      message = 'STRUCTURE_FORBIDDEN';
  end if;

  if v_session.structure_version is distinct from p_expected_structure_version then
    raise exception using
      errcode = '40001',
      message = 'STRUCTURE_VERSION_CONFLICT';
  end if;

  return v_session;
end;
$$;

create or replace function private.bump_structure_version(p_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  perform set_config('private.allow_structure_write', 'true', true);
  update public.sessions
  set structure_version = structure_version + 1
  where id = p_session_id
  returning structure_version into v_version;
  return v_version;
end;
$$;

create or replace function private.require_uuid(p_value text, p_label text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.btrim(p_value) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;
  return p_value::uuid;
exception
  when invalid_text_representation then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
end;
$$;

revoke all on function private.protect_player_link() from public;
revoke all on function private.lock_session_structure(uuid, bigint) from public;
revoke all on function private.bump_structure_version(uuid) from public;
revoke all on function private.require_uuid(text, text) from public;

-- ---------------------------------------------------------------------------
-- Grants: structural writes only via SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------
revoke insert, update, delete on table public.teams from authenticated;
revoke insert, update, delete on table public.team_members from authenticated;
revoke insert, update, delete on table public.rounds from authenticated;
revoke insert, update, delete on table public.matches from authenticated;
revoke insert, update, delete on table public.match_players from authenticated;

grant select on table public.session_players to authenticated;
grant select on table public.match_events to authenticated;
grant select on table public.player_link_claims to authenticated;

drop policy if exists teams_write on public.teams;
drop policy if exists team_members_write on public.team_members;
drop policy if exists rounds_write on public.rounds;
drop policy if exists matches_insert on public.matches;
drop policy if exists matches_update on public.matches;
drop policy if exists matches_delete on public.matches;
drop policy if exists match_players_write on public.match_players;

alter table public.session_players enable row level security;
alter table public.session_players force row level security;
alter table public.match_events enable row level security;
alter table public.match_events force row level security;
alter table public.player_link_claims enable row level security;
alter table public.player_link_claims force row level security;

create policy session_players_select on public.session_players
  for select to authenticated
  using (private.is_session_member(session_id));

create policy match_events_select on public.match_events
  for select to authenticated
  using (private.is_session_member(session_id));

create policy player_link_claims_select on public.player_link_claims
  for select to authenticated
  using (
    claimant_user_id = auth.uid()
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and (p.created_by = auth.uid() or p.linked_user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.link_player(p_player_id uuid)
returns public.players
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
  where id = p_player_id
  for update;

  if v_player.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_NOT_FOUND';
  end if;

  if v_player.created_by is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'PLAYER_LINK_REQUIRES_OWNERSHIP';
  end if;

  if v_player.linked_user_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_ALREADY_LINKED';
  end if;

  if exists (
    select 1 from public.players p
    where p.linked_user_id = v_uid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'USER_ALREADY_LINKED';
  end if;

  perform set_config('private.allow_player_link', 'true', true);

  update public.players
  set linked_user_id = v_uid
  where id = p_player_id
  returning * into v_player;

  return v_player;
end;
$$;

create or replace function public.add_session_player(
  p_session_id uuid,
  p_player_id uuid,
  p_player_name_snapshot text,
  p_expected_structure_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_player public.players;
  v_name text;
begin
  v_session := private.lock_session_structure(p_session_id, p_expected_structure_version);

  if v_session.status is distinct from 'draft' then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOT_DRAFT';
  end if;

  select * into v_player from public.players where id = p_player_id;
  if v_player.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_NOT_FOUND';
  end if;
  if v_player.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_ARCHIVED';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_player_name_snapshot, v_player.name, ''));
  if v_name = '' then
    v_name := v_player.name;
  end if;

  insert into public.session_players (session_id, player_id, player_name_snapshot)
  values (p_session_id, p_player_id, v_name)
  on conflict (session_id, player_id) do nothing;

  return private.bump_structure_version(p_session_id);
end;
$$;

create or replace function public.remove_session_player(
  p_session_id uuid,
  p_player_id uuid,
  p_expected_structure_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  v_session := private.lock_session_structure(p_session_id, p_expected_structure_version);

  if v_session.status is distinct from 'draft' then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOT_DRAFT';
  end if;

  if exists (
    select 1 from public.team_members tm
    where tm.session_id = p_session_id and tm.player_id = p_player_id
  ) or exists (
    select 1 from public.match_players mp
    where mp.session_id = p_session_id and mp.player_id = p_player_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_IN_TEAM';
  end if;

  delete from public.session_players
  where session_id = p_session_id and player_id = p_player_id;

  return private.bump_structure_version(p_session_id);
end;
$$;

create or replace function public.replace_session_teams(
  p_session_id uuid,
  p_expected_structure_version bigint,
  p_teams jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_team jsonb;
  v_member jsonb;
  v_team_id uuid;
  v_player_id uuid;
  v_name text;
begin
  v_session := private.lock_session_structure(p_session_id, p_expected_structure_version);

  if v_session.status is distinct from 'draft' then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOT_DRAFT';
  end if;

  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  delete from public.rounds where session_id = p_session_id;
  delete from public.teams where session_id = p_session_id;

  for v_team in select value from jsonb_array_elements(p_teams)
  loop
    v_team_id := private.require_uuid(v_team->>'id', 'team');
    insert into public.teams (id, session_id, name, sort_index)
    values (
      v_team_id,
      p_session_id,
      nullif(pg_catalog.btrim(coalesce(v_team->>'name', '')), ''),
      coalesce((v_team->>'sort_index')::integer, 0)
    );

    if jsonb_typeof(v_team->'members') is distinct from 'array' then
      continue;
    end if;

    for v_member in select value from jsonb_array_elements(v_team->'members')
    loop
      v_player_id := private.require_uuid(v_member->>'player_id', 'player');
      v_name := pg_catalog.btrim(coalesce(v_member->>'player_name_snapshot', ''));
      if v_name = '' then
        select sp.player_name_snapshot into v_name
        from public.session_players sp
        where sp.session_id = p_session_id and sp.player_id = v_player_id;
      end if;
      if not exists (
        select 1 from public.session_players sp
        where sp.session_id = p_session_id and sp.player_id = v_player_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'PLAYER_NOT_IN_SESSION';
      end if;
      insert into public.team_members (team_id, session_id, player_id, player_name_snapshot)
      values (v_team_id, p_session_id, v_player_id, coalesce(v_name, ''));
    end loop;
  end loop;

  return private.bump_structure_version(p_session_id);
end;
$$;

create or replace function public.apply_session_rounds(
  p_session_id uuid,
  p_expected_structure_version bigint,
  p_mode text,
  p_rounds jsonb,
  p_court_count integer default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_round jsonb;
  v_match jsonb;
  v_player jsonb;
  v_round_id uuid;
  v_match_id uuid;
  v_bye uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_player_id uuid;
  v_name text;
  v_side text;
begin
  v_session := private.lock_session_structure(p_session_id, p_expected_structure_version);

  if p_mode not in ('replace', 'append') or jsonb_typeof(p_rounds) is distinct from 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if p_mode = 'replace' then
    if v_session.status is distinct from 'draft' then
      raise exception using
        errcode = 'P0001',
        message = 'SESSION_NOT_DRAFT';
    end if;
    delete from public.rounds where session_id = p_session_id;
  else
    if v_session.status is distinct from 'in_progress' then
      raise exception using
        errcode = 'P0001',
        message = 'SESSION_NOT_IN_PROGRESS';
    end if;
  end if;

  for v_round in select value from jsonb_array_elements(p_rounds)
  loop
    v_round_id := private.require_uuid(v_round->>'id', 'round');
    v_bye := null;
    if nullif(v_round->>'bye_team_id', '') is not null then
      v_bye := private.require_uuid(v_round->>'bye_team_id', 'bye');
    end if;

    insert into public.rounds (id, session_id, number, cycle_number, bye_team_id)
    values (
      v_round_id,
      p_session_id,
      (v_round->>'number')::integer,
      coalesce((v_round->>'cycle_number')::integer, 1),
      v_bye
    );

    for v_match in select value from jsonb_array_elements(coalesce(v_round->'matches', '[]'::jsonb))
    loop
      v_match_id := private.require_uuid(v_match->>'id', 'match');
      v_team_a := private.require_uuid(v_match->>'team_a_id', 'team_a');
      v_team_b := private.require_uuid(v_match->>'team_b_id', 'team_b');

      insert into public.matches (id, session_id, round_id, team_a_id, team_b_id)
      values (v_match_id, p_session_id, v_round_id, v_team_a, v_team_b);

      foreach v_side in array array['a', 'b']
      loop
        for v_player in
          select value
          from jsonb_array_elements(coalesce(v_match->('lineup_' || v_side), '[]'::jsonb))
        loop
          v_player_id := private.require_uuid(v_player->>'player_id', 'lineup');
          if not exists (
            select 1 from public.session_players sp
            where sp.session_id = p_session_id and sp.player_id = v_player_id
          ) then
            raise exception using
              errcode = 'P0001',
              message = 'PLAYER_NOT_IN_SESSION';
          end if;
          v_name := pg_catalog.btrim(coalesce(v_player->>'player_name_snapshot', ''));
          if v_name = '' then
            select sp.player_name_snapshot into v_name
            from public.session_players sp
            where sp.session_id = p_session_id and sp.player_id = v_player_id;
          end if;
          insert into public.match_players (
            match_id, session_id, player_id, side, sort_index, player_name_snapshot
          )
          values (
            v_match_id,
            p_session_id,
            v_player_id,
            v_side,
            coalesce((v_player->>'sort_index')::integer, 0),
            coalesce(v_name, '')
          );
        end loop;
      end loop;
    end loop;
  end loop;

  if p_mode = 'replace' then
    perform set_config('private.allow_status_write', 'true', true);
    update public.sessions
    set
      status = 'in_progress',
      court_count = p_court_count
    where id = p_session_id;
  elsif p_court_count is not null then
    update public.sessions
    set court_count = p_court_count
    where id = p_session_id;
  end if;

  return private.bump_structure_version(p_session_id);
end;
$$;

create or replace function public.reset_session_to_draft(
  p_session_id uuid,
  p_expected_structure_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  v_session := private.lock_session_structure(p_session_id, p_expected_structure_version);

  if v_session.status is distinct from 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOT_IN_PROGRESS';
  end if;

  delete from public.rounds where session_id = p_session_id;

  perform set_config('private.allow_status_write', 'true', true);
  update public.sessions
  set status = 'draft', court_count = null
  where id = p_session_id;

  return private.bump_structure_version(p_session_id);
end;
$$;

create or replace function public.set_match_lineups(
  p_match_id uuid,
  p_expected_structure_version bigint,
  p_lineup_a jsonb,
  p_lineup_b jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_session public.sessions;
  v_player jsonb;
  v_player_id uuid;
  v_name text;
  v_side text;
  v_lineup jsonb;
begin
  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'MATCH_NOT_FOUND';
  end if;

  v_session := private.lock_session_structure(v_match.session_id, p_expected_structure_version);
  if v_session.status is distinct from 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOT_IN_PROGRESS';
  end if;

  if jsonb_typeof(p_lineup_a) is distinct from 'array'
     or jsonb_typeof(p_lineup_b) is distinct from 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  delete from public.match_players where match_id = p_match_id;

  foreach v_side in array array['a', 'b']
  loop
    v_lineup := case when v_side = 'a' then p_lineup_a else p_lineup_b end;
    for v_player in select value from jsonb_array_elements(v_lineup)
    loop
      v_player_id := private.require_uuid(v_player->>'player_id', 'lineup');
      if not exists (
        select 1 from public.session_players sp
        where sp.session_id = v_match.session_id and sp.player_id = v_player_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'PLAYER_NOT_IN_SESSION';
      end if;
      v_name := pg_catalog.btrim(coalesce(v_player->>'player_name_snapshot', ''));
      if v_name = '' then
        select sp.player_name_snapshot into v_name
        from public.session_players sp
        where sp.session_id = v_match.session_id and sp.player_id = v_player_id;
      end if;
      insert into public.match_players (
        match_id, session_id, player_id, side, sort_index, player_name_snapshot
      )
      values (
        p_match_id,
        v_match.session_id,
        v_player_id,
        v_side,
        coalesce((v_player->>'sort_index')::integer, 0),
        coalesce(v_name, '')
      );
    end loop;
  end loop;

  return private.bump_structure_version(v_match.session_id);
end;
$$;

create or replace function public.finalize_session(
  p_session_id uuid,
  p_expected_structure_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  v_session := private.lock_session_structure(p_session_id, p_expected_structure_version);

  if v_session.status is distinct from 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOT_IN_PROGRESS';
  end if;

  if not exists (select 1 from public.matches m where m.session_id = p_session_id) then
    raise exception using
      errcode = 'P0001',
      message = 'FINALIZE_NO_MATCHES';
  end if;

  if exists (
    select 1
    from public.matches m
    where m.session_id = p_session_id
      and (m.score_a is null or m.score_b is null)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FINALIZE_INCOMPLETE';
  end if;

  if exists (
    select 1
    from public.team_members tm
    where tm.session_id = p_session_id
      and not exists (
        select 1 from public.session_players sp
        where sp.session_id = tm.session_id and sp.player_id = tm.player_id
      )
  ) or exists (
    select 1
    from public.match_players mp
    where mp.session_id = p_session_id
      and not exists (
        select 1 from public.session_players sp
        where sp.session_id = mp.session_id and sp.player_id = mp.player_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PLAYER_NOT_IN_SESSION';
  end if;

  perform set_config('private.allow_status_write', 'true', true);
  update public.sessions
  set status = 'finished'
  where id = p_session_id;

  return private.bump_structure_version(p_session_id);
end;
$$;

create or replace function public.set_match_score(
  p_match_id uuid,
  p_score_a integer,
  p_score_b integer,
  p_expected_version bigint
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_before public.matches;
  v_updated public.matches;
  v_status text;
  v_role text;
  v_event text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_before
  from public.matches
  where id = p_match_id
  for update;

  if v_before.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'MATCH_NOT_FOUND';
  end if;

  select s.status into v_status
  from public.sessions s
  where s.id = v_before.session_id;

  v_role := private.session_role(v_before.session_id);
  if v_role is null or v_role = 'viewer' then
    raise exception using
      errcode = '42501',
      message = 'SCORE_FORBIDDEN';
  end if;

  if v_status is distinct from 'in_progress' and v_status is distinct from 'finished' then
    raise exception using
      errcode = '42501',
      message = 'SCORE_FORBIDDEN';
  end if;

  if (p_score_a is null) <> (p_score_b is null) then
    raise exception using
      errcode = 'P0001',
      message = 'SCORE_PARTIAL';
  end if;

  if p_score_a is null and p_score_b is null then
    if v_status is distinct from 'in_progress' or v_role not in ('owner', 'admin') then
      raise exception using
        errcode = '42501',
        message = 'SCORE_CLEAR_FORBIDDEN';
    end if;
    v_event := 'clear_score';
  else
    if v_status = 'finished' and v_role not in ('owner', 'admin') then
      raise exception using
        errcode = '42501',
        message = 'SCORE_FORBIDDEN';
    end if;
    if p_score_a < 0 or p_score_b < 0 then
      raise exception using
        errcode = 'P0001',
        message = 'SCORE_NEGATIVE';
    end if;
    if p_score_a = p_score_b then
      raise exception using
        errcode = 'P0001',
        message = 'SCORE_TIE';
    end if;
    v_event := 'set_score';
  end if;

  perform set_config('private.allow_score_write', 'true', true);

  update public.matches
  set
    score_a = p_score_a,
    score_b = p_score_b,
    version = version + 1,
    updated_by = v_uid,
    updated_at = pg_catalog.now()
  where id = p_match_id
    and version = p_expected_version
  returning * into v_updated;

  if v_updated.id is null then
    raise exception using
      errcode = '40001',
      message = 'SCORE_VERSION_CONFLICT',
      detail = pg_catalog.json_build_object(
        'score_a', v_before.score_a,
        'score_b', v_before.score_b,
        'version', v_before.version
      )::text;
  end if;

  insert into public.match_events (
    session_id,
    match_id,
    user_id,
    event_type,
    old_score_a,
    old_score_b,
    new_score_a,
    new_score_b,
    match_version_before,
    match_version_after
  )
  values (
    v_updated.session_id,
    v_updated.id,
    v_uid,
    v_event,
    v_before.score_a,
    v_before.score_b,
    v_updated.score_a,
    v_updated.score_b,
    v_before.version,
    v_updated.version
  );

  return v_updated;
end;
$$;

revoke all on function public.link_player(uuid) from public;
revoke all on function public.link_player(uuid) from anon;
revoke all on function public.add_session_player(uuid, uuid, text, bigint) from public;
revoke all on function public.add_session_player(uuid, uuid, text, bigint) from anon;
revoke all on function public.remove_session_player(uuid, uuid, bigint) from public;
revoke all on function public.remove_session_player(uuid, uuid, bigint) from anon;
revoke all on function public.replace_session_teams(uuid, bigint, jsonb) from public;
revoke all on function public.replace_session_teams(uuid, bigint, jsonb) from anon;
revoke all on function public.apply_session_rounds(uuid, bigint, text, jsonb, integer) from public;
revoke all on function public.apply_session_rounds(uuid, bigint, text, jsonb, integer) from anon;
revoke all on function public.reset_session_to_draft(uuid, bigint) from public;
revoke all on function public.reset_session_to_draft(uuid, bigint) from anon;
revoke all on function public.set_match_lineups(uuid, bigint, jsonb, jsonb) from public;
revoke all on function public.set_match_lineups(uuid, bigint, jsonb, jsonb) from anon;
revoke all on function public.finalize_session(uuid, bigint) from public;
revoke all on function public.finalize_session(uuid, bigint) from anon;
revoke all on function public.set_match_score(uuid, integer, integer, bigint) from public;
revoke all on function public.set_match_score(uuid, integer, integer, bigint) from anon;

grant execute on function public.link_player(uuid) to authenticated;
grant execute on function public.add_session_player(uuid, uuid, text, bigint) to authenticated;
grant execute on function public.remove_session_player(uuid, uuid, bigint) to authenticated;
grant execute on function public.replace_session_teams(uuid, bigint, jsonb) to authenticated;
grant execute on function public.apply_session_rounds(uuid, bigint, text, jsonb, integer) to authenticated;
grant execute on function public.reset_session_to_draft(uuid, bigint) to authenticated;
grant execute on function public.set_match_lineups(uuid, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.finalize_session(uuid, bigint) to authenticated;
grant execute on function public.set_match_score(uuid, integer, integer, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $realtime_table$
begin
  alter table public.sessions replica identity full;
  alter table public.session_members replica identity full;
  alter table public.session_players replica identity full;
  alter table public.teams replica identity full;
  alter table public.team_members replica identity full;
  alter table public.rounds replica identity full;
  alter table public.match_players replica identity full;
  alter table public.match_events replica identity full;
  alter publication supabase_realtime add table public.sessions;
  alter publication supabase_realtime add table public.session_members;
  alter publication supabase_realtime add table public.session_players;
  alter publication supabase_realtime add table public.teams;
  alter publication supabase_realtime add table public.team_members;
  alter publication supabase_realtime add table public.rounds;
  alter publication supabase_realtime add table public.match_players;
  alter publication supabase_realtime add table public.match_events;
exception
  when duplicate_object then
    null;
  when undefined_object then
    null;
  when insufficient_privilege then
    null;
end;
$realtime_table$;
