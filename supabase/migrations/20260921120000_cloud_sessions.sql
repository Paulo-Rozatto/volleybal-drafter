-- Cloud sessions (etapa 1). Relacional; Gist permanece no SPA.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to postgres;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.players (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  skill_score integer check (skill_score between 1 and 5),
  gender text check (gender in ('F', 'M')),
  height text check (height in ('tall', 'short')),
  linked_user_id uuid unique references public.profiles (id),
  created_by uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  name text,
  date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'finished')),
  team_size integer not null check (team_size between 2 and 6),
  team_count integer not null check (team_count >= 2),
  court_count integer check (court_count is null or court_count >= 1),
  join_code text not null unique
    check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.session_members (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (session_id, user_id)
);

create table public.teams (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  name text,
  sort_index integer not null default 0,
  unique (id, session_id)
);

create table public.team_members (
  team_id uuid not null,
  session_id uuid not null,
  player_id uuid not null references public.players (id) on delete restrict,
  player_name_snapshot text not null,
  primary key (team_id, player_id),
  unique (session_id, player_id),
  foreign key (team_id, session_id)
    references public.teams (id, session_id) on delete cascade
);

create table public.rounds (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  number integer not null,
  cycle_number integer not null default 1,
  bye_team_id uuid,
  unique (id, session_id),
  unique (session_id, cycle_number, number),
  foreign key (bye_team_id, session_id)
    references public.teams (id, session_id)
);

create table public.matches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  round_id uuid not null,
  team_a_id uuid not null,
  team_b_id uuid not null,
  score_a integer,
  score_b integer,
  version bigint not null default 0,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default pg_catalog.now(),
  check (team_a_id <> team_b_id),
  check (
    (score_a is null and score_b is null)
    or (score_a >= 0 and score_b >= 0 and score_a is distinct from score_b)
  ),
  unique (id, session_id),
  foreign key (round_id, session_id)
    references public.rounds (id, session_id) on delete cascade,
  foreign key (team_a_id, session_id)
    references public.teams (id, session_id),
  foreign key (team_b_id, session_id)
    references public.teams (id, session_id)
);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  side text not null check (side in ('a', 'b')),
  sort_index integer not null default 0,
  player_name_snapshot text not null,
  primary key (match_id, player_id)
);

create index session_members_user_id_idx on public.session_members (user_id);
create index matches_session_id_idx on public.matches (session_id);
create index players_created_by_idx on public.players (created_by);
create index team_members_session_id_idx on public.team_members (session_id);
create index match_players_player_id_idx on public.match_players (player_id);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------
create function private.normalize_join_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.upper(
    pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_code, '')), '\s+', '', 'g')
  );
$$;

create function private.generate_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  alphabet_len integer;
  candidate text;
  attempt integer;
  pos integer;
begin
  alphabet_len := pg_catalog.length(alphabet);
  for attempt in 1..48 loop
    candidate := '';
    for pos in 1..8 loop
      candidate := candidate || pg_catalog.substr(
        alphabet,
        1 + (pg_catalog.floor(pg_catalog.random() * alphabet_len))::integer,
        1
      );
    end loop;
    if not exists (
      select 1 from public.sessions s where s.join_code = candidate
    ) then
      return candidate;
    end if;
  end loop;

  raise exception using
    errcode = 'P0001',
    message = 'JOIN_CODE_GENERATION_FAILED';
end;
$$;

create function private.session_role(p_session_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role
  from public.session_members sm
  where sm.session_id = p_session_id
    and sm.user_id = auth.uid()
  limit 1;
$$;

create function private.is_session_member(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_role(p_session_id) is not null;
$$;

create function private.can_manage_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_role(p_session_id) in ('owner', 'admin');
$$;

create function private.can_score_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_role(p_session_id) in ('owner', 'admin', 'member');
$$;

create function private.shares_session_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_members me
    inner join public.session_members them
      on them.session_id = me.session_id
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
  );
$$;

create function private.player_visible_to_me(p_player_id uuid)
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

revoke all on function private.normalize_join_code(text) from public;
revoke all on function private.generate_join_code() from public;
revoke all on function private.session_role(uuid) from public;
revoke all on function private.is_session_member(uuid) from public;
revoke all on function private.can_manage_session(uuid) from public;
revoke all on function private.can_score_session(uuid) from public;
revoke all on function private.shares_session_with(uuid) from public;
revoke all on function private.player_visible_to_me(uuid) from public;

grant execute on function private.session_role(uuid) to authenticated;
grant execute on function private.is_session_member(uuid) to authenticated;
grant execute on function private.can_manage_session(uuid) to authenticated;
grant execute on function private.can_score_session(uuid) to authenticated;
grant execute on function private.shares_session_with(uuid) to authenticated;
grant execute on function private.player_visible_to_me(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_name text;
  email_local text;
begin
  meta_name := pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'display_name', ''));
  email_local := pg_catalog.split_part(coalesce(new.email, ''), '@', 1);

  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(meta_name, ''), nullif(email_local, ''), '')
  );
  return new;
end;
$$;

create function private.prepare_new_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.join_code is null or pg_catalog.btrim(new.join_code) = '' then
    new.join_code := private.generate_join_code();
  else
    new.join_code := private.normalize_join_code(new.join_code);
  end if;

  perform set_config('private.inserting_session_id', new.id::text, true);
  return new;
end;
$$;

create function private.add_session_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.session_members (session_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create function private.protect_session_audit_fields()
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

  return new;
end;
$$;

create function private.protect_match_score_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (
       new.score_a is distinct from old.score_a
       or new.score_b is distinct from old.score_b
       or new.version is distinct from old.version
       or new.updated_by is distinct from old.updated_by
     )
     and current_setting('private.allow_score_write', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'USE_SET_MATCH_SCORE';
  end if;
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.handle_new_user() from public;
revoke all on function private.prepare_new_session() from public;
revoke all on function private.add_session_owner() from public;
revoke all on function private.protect_session_audit_fields() from public;
revoke all on function private.protect_match_score_columns() from public;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger players_set_updated_at
  before update on public.players
  for each row execute function private.set_updated_at();

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function private.set_updated_at();

create trigger sessions_prepare
  before insert on public.sessions
  for each row execute function private.prepare_new_session();

create trigger sessions_add_owner
  after insert on public.sessions
  for each row execute function private.add_session_owner();

create trigger sessions_protect_audit
  before update on public.sessions
  for each row execute function private.protect_session_audit_fields();

create trigger matches_protect_score
  before update on public.matches
  for each row execute function private.protect_match_score_columns();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
create function public.join_session_by_code(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_session_id uuid;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_code := private.normalize_join_code(p_join_code);
  if v_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception using
      errcode = 'P0001',
      message = 'JOIN_CODE_INVALID';
  end if;

  select s.id into v_session_id
  from public.sessions s
  where s.join_code = v_code;

  if v_session_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'JOIN_CODE_NOT_FOUND';
  end if;

  insert into public.session_members (session_id, user_id, role)
  values (v_session_id, v_uid, 'member')
  on conflict (session_id, user_id) do nothing;

  return v_session_id;
end;
$$;

create function public.rotate_session_join_code(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if not private.can_manage_session(p_session_id) then
    raise exception using
      errcode = '42501',
      message = 'JOIN_CODE_ROTATE_FORBIDDEN';
  end if;

  v_code := private.generate_join_code();
  perform set_config('private.allow_join_code_rotate', 'true', true);

  update public.sessions
  set join_code = v_code
  where id = p_session_id;

  return v_code;
end;
$$;

create function public.set_match_score(
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
  v_session_id uuid;
  v_role text;
  v_updated public.matches;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select m.session_id into v_session_id
  from public.matches m
  where m.id = p_match_id;

  if v_session_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'MATCH_NOT_FOUND';
  end if;

  v_role := private.session_role(v_session_id);
  if v_role is null or v_role = 'viewer' then
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
    if v_role not in ('owner', 'admin') then
      raise exception using
        errcode = '42501',
        message = 'SCORE_CLEAR_FORBIDDEN';
    end if;
  else
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
      message = 'SCORE_VERSION_CONFLICT';
  end if;

  return v_updated;
end;
$$;

revoke all on function public.join_session_by_code(text) from public;
revoke all on function public.join_session_by_code(text) from anon;
revoke all on function public.rotate_session_join_code(uuid) from public;
revoke all on function public.rotate_session_join_code(uuid) from anon;
revoke all on function public.set_match_score(uuid, integer, integer, bigint) from public;
revoke all on function public.set_match_score(uuid, integer, integer, bigint) from anon;

grant execute on function public.join_session_by_code(text) to authenticated;
grant execute on function public.rotate_session_join_code(uuid) to authenticated;
grant execute on function public.set_match_score(uuid, integer, integer, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants (table)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.players to authenticated;
grant select, insert, update, delete on table public.sessions to authenticated;
grant select, update, delete on table public.session_members to authenticated;
grant select, insert, update, delete on table public.teams to authenticated;
grant select, insert, update, delete on table public.team_members to authenticated;
grant select, insert, update, delete on table public.rounds to authenticated;
grant select, insert, delete, update on table public.matches to authenticated;
grant select, insert, update, delete on table public.match_players to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;

alter table public.profiles force row level security;
alter table public.players force row level security;
alter table public.sessions force row level security;
alter table public.session_members force row level security;
alter table public.teams force row level security;
alter table public.team_members force row level security;
alter table public.rounds force row level security;
alter table public.matches force row level security;
alter table public.match_players force row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.shares_session_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy players_select on public.players
  for select to authenticated
  using (
    created_by = auth.uid()
    or linked_user_id = auth.uid()
    or private.player_visible_to_me(id)
  );

create policy players_insert on public.players
  for insert to authenticated
  with check (created_by = auth.uid());

create policy players_update on public.players
  for update to authenticated
  using (created_by = auth.uid() or linked_user_id = auth.uid())
  with check (created_by = auth.uid() or linked_user_id = auth.uid());

create policy sessions_select on public.sessions
  for select to authenticated
  using (
    private.is_session_member(id)
    or id::text = current_setting('private.inserting_session_id', true)
  );

create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (created_by = auth.uid());

create policy sessions_update on public.sessions
  for update to authenticated
  using (private.can_manage_session(id))
  with check (private.can_manage_session(id));

create policy sessions_delete on public.sessions
  for delete to authenticated
  using (private.session_role(id) = 'owner');

create policy session_members_select on public.session_members
  for select to authenticated
  using (private.is_session_member(session_id));

create policy session_members_update on public.session_members
  for update to authenticated
  using (private.session_role(session_id) = 'owner')
  with check (private.session_role(session_id) = 'owner');

create policy session_members_delete on public.session_members
  for delete to authenticated
  using (
    private.session_role(session_id) = 'owner'
    and user_id <> auth.uid()
  );

create policy teams_select on public.teams
  for select to authenticated
  using (private.is_session_member(session_id));

create policy teams_write on public.teams
  for all to authenticated
  using (private.can_manage_session(session_id))
  with check (private.can_manage_session(session_id));

create policy team_members_select on public.team_members
  for select to authenticated
  using (private.is_session_member(session_id));

create policy team_members_write on public.team_members
  for all to authenticated
  using (private.can_manage_session(session_id))
  with check (private.can_manage_session(session_id));

create policy rounds_select on public.rounds
  for select to authenticated
  using (private.is_session_member(session_id));

create policy rounds_write on public.rounds
  for all to authenticated
  using (private.can_manage_session(session_id))
  with check (private.can_manage_session(session_id));

create policy matches_select on public.matches
  for select to authenticated
  using (private.is_session_member(session_id));

create policy matches_insert on public.matches
  for insert to authenticated
  with check (private.can_manage_session(session_id));

create policy matches_update on public.matches
  for update to authenticated
  using (private.can_manage_session(session_id))
  with check (private.can_manage_session(session_id));

create policy matches_delete on public.matches
  for delete to authenticated
  using (private.can_manage_session(session_id));

create policy match_players_select on public.match_players
  for select to authenticated
  using (
    exists (
      select 1
      from public.matches m
      where m.id = match_id
        and private.is_session_member(m.session_id)
    )
  );

create policy match_players_write on public.match_players
  for all to authenticated
  using (
    exists (
      select 1
      from public.matches m
      where m.id = match_id
        and private.can_manage_session(m.session_id)
    )
  )
  with check (
    exists (
      select 1
      from public.matches m
      where m.id = match_id
        and private.can_manage_session(m.session_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $realtime$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
exception
  when duplicate_object then
    null;
  when insufficient_privilege then
    null;
end;
$realtime$;

do $realtime_table$
begin
  alter table public.matches replica identity full;
  alter publication supabase_realtime add table public.matches;
exception
  when duplicate_object then
    null;
  when undefined_object then
    null;
  when insufficient_privilege then
    null;
end;
$realtime_table$;
