-- Cloud competitions (etapa 6).
-- group_members != session_members != session_players
--   != competition_members != competition_players
-- JS owns bracket/standings. SQL persists, authorizes, versions, audits.
-- Do not apply on hosted Supabase until this migration is reviewed.
-- Realtime publication is declared here; hosted apply remains a later checklist.

-- ---------------------------------------------------------------------------
-- Join codes: sessions, groups and competitions share the alphabet.
-- ---------------------------------------------------------------------------
create or replace function private.generate_join_code()
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
    if not exists (select 1 from public.sessions s where s.join_code = candidate)
       and not exists (select 1 from public.groups g where g.join_code = candidate)
       and not exists (select 1 from public.competitions c where c.join_code = candidate)
    then
      return candidate;
    end if;
  end loop;

  raise exception using
    errcode = 'P0001',
    message = 'JOIN_CODE_GENERATION_FAILED';
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.competitions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid references public.groups (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  name text,
  date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'finished')),
  format_team_size integer not null check (format_team_size between 2 and 6),
  join_code text not null unique
    check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  structure_version bigint not null default 0,
  legacy_source_id text unique,
  seed_team_ids uuid[] not null default '{}',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.competition_members (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (competition_id, user_id)
);

create table public.competition_players (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  player_name_snapshot text not null,
  sort_index integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (competition_id, player_id)
);

create table public.competition_teams (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  sort_index integer not null default 0,
  unique (id, competition_id)
);

create table public.competition_team_members (
  team_id uuid not null,
  competition_id uuid not null,
  player_id uuid not null,
  player_name_snapshot text not null,
  sort_index integer not null default 0,
  primary key (team_id, player_id),
  unique (competition_id, player_id),
  foreign key (team_id, competition_id)
    references public.competition_teams (id, competition_id) on delete cascade,
  foreign key (competition_id, player_id)
    references public.competition_players (competition_id, player_id)
);

create table public.competition_stages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  number integer not null,
  name text,
  type text not null check (
    type in ('swiss', 'double_elimination', 'single_elimination', 'round_robin', 'groups')
  ),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'finished')),
  config jsonb not null default '{}'::jsonb,
  seed_team_ids uuid[] not null default '{}',
  seed_snapshot jsonb,
  unique (id, competition_id),
  unique (competition_id, number)
);

create table public.competition_rounds (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  competition_id uuid not null,
  stage_id uuid not null,
  number integer not null,
  name text,
  bracket text,
  unique (id, competition_id),
  foreign key (stage_id, competition_id)
    references public.competition_stages (id, competition_id) on delete cascade
);

create table public.competition_round_byes (
  round_id uuid not null,
  competition_id uuid not null,
  team_id uuid not null,
  primary key (round_id, team_id),
  foreign key (round_id, competition_id)
    references public.competition_rounds (id, competition_id) on delete cascade,
  foreign key (team_id, competition_id)
    references public.competition_teams (id, competition_id)
);

create table public.competition_matches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  competition_id uuid not null,
  stage_id uuid not null,
  round_id uuid not null,
  source_a jsonb not null default '{}'::jsonb,
  source_b jsonb not null default '{}'::jsonb,
  team_a_id uuid,
  team_b_id uuid,
  score_a integer,
  score_b integer,
  played_date date,
  winner_team_id uuid,
  version bigint not null default 0,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default pg_catalog.now(),
  check (
    (score_a is null and score_b is null)
    or (score_a >= 0 and score_b >= 0 and score_a is distinct from score_b)
  ),
  unique (id, competition_id),
  foreign key (round_id, competition_id)
    references public.competition_rounds (id, competition_id) on delete cascade,
  foreign key (stage_id, competition_id)
    references public.competition_stages (id, competition_id) on delete cascade,
  foreign key (team_a_id, competition_id)
    references public.competition_teams (id, competition_id),
  foreign key (team_b_id, competition_id)
    references public.competition_teams (id, competition_id),
  foreign key (winner_team_id, competition_id)
    references public.competition_teams (id, competition_id)
);

-- Single composite FK to competition_matches (no extra match_id FK) so PostgREST
-- cannot create an ambiguous embed like matches <-> match_players.
create table public.competition_match_players (
  match_id uuid not null,
  competition_id uuid not null,
  player_id uuid not null,
  side text not null check (side in ('a', 'b')),
  sort_index integer not null default 0,
  player_name_snapshot text not null,
  primary key (match_id, player_id),
  foreign key (match_id, competition_id)
    references public.competition_matches (id, competition_id) on delete cascade,
  foreign key (competition_id, player_id)
    references public.competition_players (competition_id, player_id)
);

create table public.competition_match_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  match_id uuid not null,
  user_id uuid not null references public.profiles (id),
  event_type text not null check (event_type in ('set_score', 'clear_score')),
  old_score_a integer,
  old_score_b integer,
  new_score_a integer,
  new_score_b integer,
  match_version_before bigint not null,
  match_version_after bigint not null,
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (match_id, competition_id)
    references public.competition_matches (id, competition_id) on delete cascade
);

create index competitions_group_id_idx on public.competitions (group_id);
create index competitions_created_by_idx on public.competitions (created_by);
create index competitions_status_idx on public.competitions (status);
create index competition_members_user_id_idx on public.competition_members (user_id);
create index competition_players_player_id_idx on public.competition_players (player_id);
create index competition_matches_competition_id_idx on public.competition_matches (competition_id);
create index competition_match_players_player_match_idx
  on public.competition_match_players (player_id, match_id);
create index competition_match_events_match_id_idx on public.competition_match_events (match_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.competition_role(p_competition_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select cm.role
  from public.competition_members cm
  where cm.competition_id = p_competition_id
    and cm.user_id = auth.uid()
  limit 1;
$$;

create or replace function private.is_competition_member(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.competition_role(p_competition_id) is not null;
$$;

create or replace function private.can_manage_competition(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.competition_role(p_competition_id) in ('owner', 'admin');
$$;

create or replace function private.shares_competition_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.competition_members me
    inner join public.competition_members them
      on them.competition_id = me.competition_id
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
  );
$$;

-- Same pattern as private.shares_session_with; etapa 4 never added this helper.
create or replace function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members me
    inner join public.group_members them
      on them.group_id = me.group_id
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
  );
$$;

create or replace function private.lock_competition_structure(
  p_competition_id uuid,
  p_expected_structure_version bigint
)
returns public.competitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competition public.competitions;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_competition
  from public.competitions
  where id = p_competition_id
  for update;

  if v_competition.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'COMPETITION_NOT_FOUND';
  end if;

  if v_competition.structure_version is distinct from p_expected_structure_version then
    raise exception using
      errcode = '40001',
      message = 'COMPETITION_STRUCTURE_VERSION_CONFLICT';
  end if;

  return v_competition;
end;
$$;

create or replace function private.bump_competition_structure_version(p_competition_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  update public.competitions
  set structure_version = structure_version + 1
  where id = p_competition_id
  returning structure_version into v_version;
  return v_version;
end;
$$;

create or replace function private.json_text(p_obj jsonb, p_camel text, p_snake text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(coalesce(p_obj ->> p_camel, p_obj ->> p_snake, '')), '');
$$;

create or replace function private.json_int(p_obj jsonb, p_camel text, p_snake text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select nullif(coalesce(p_obj ->> p_camel, p_obj ->> p_snake, ''), '')::integer;
$$;

-- Score RPC must not replace the graph. Validate structure, then patch
-- only the target score/played_date plus derived bracket resolution fields.
create or replace function private.apply_competition_score_document(
  p_competition_id uuid,
  p_match_id uuid,
  p_score_a integer,
  p_score_b integer,
  p_played_date date,
  p_document jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team jsonb;
  v_member jsonb;
  v_stage jsonb;
  v_round jsonb;
  v_match jsonb;
  v_bye jsonb;
  v_stage_id uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_team_id uuid;
  v_player_id uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_winner uuid;
  v_status text;
  v_seed uuid[];
  v_doc_name text;
  v_doc_date date;
  v_doc_size integer;
  v_sort integer;
  v_header public.competitions;
  v_row record;
begin
  if jsonb_typeof(p_document) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  select * into v_header
  from public.competitions
  where id = p_competition_id;

  v_doc_name := nullif(pg_catalog.btrim(coalesce(p_document ->> 'name', '')), '');
  v_doc_date := nullif(p_document ->> 'date', '')::date;
  v_doc_size := coalesce(
    (p_document #>> '{format,teamSize}')::integer,
    (p_document ->> 'format_team_size')::integer
  );
  select coalesce(array_agg(x::uuid), '{}')
  into v_seed
  from jsonb_array_elements_text(
    coalesce(p_document -> 'seedTeamIds', p_document -> 'seed_team_ids', '[]'::jsonb)
  ) as x;

  if v_header.name is distinct from v_doc_name
     or v_header.date is distinct from v_doc_date
     or v_header.format_team_size is distinct from v_doc_size
     or v_header.seed_team_ids is distinct from coalesce(v_seed, '{}')
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  create temporary table if not exists tmp_score_doc_teams (
    id uuid primary key,
    sort_index integer not null
  ) on commit drop;
  create temporary table if not exists tmp_score_doc_members (
    team_id uuid not null,
    player_id uuid not null,
    sort_index integer not null
  ) on commit drop;
  create temporary table if not exists tmp_score_doc_stages (
    id uuid primary key,
    number integer,
    name text,
    type text,
    config jsonb,
    seed_team_ids uuid[],
    status text,
    seed_snapshot jsonb
  ) on commit drop;
  create temporary table if not exists tmp_score_doc_rounds (
    id uuid primary key,
    stage_id uuid not null,
    number integer,
    name text,
    bracket text
  ) on commit drop;
  create temporary table if not exists tmp_score_doc_byes (
    round_id uuid not null,
    team_id uuid not null
  ) on commit drop;
  create temporary table if not exists tmp_score_doc_matches (
    id uuid primary key,
    stage_id uuid not null,
    round_id uuid not null,
    source_a jsonb,
    source_b jsonb,
    team_a_id uuid,
    team_b_id uuid,
    score_a integer,
    score_b integer,
    played_date date,
    winner_team_id uuid,
    lineup_a jsonb,
    lineup_b jsonb
  ) on commit drop;
  create temporary table if not exists tmp_score_other_before (
    id uuid primary key,
    score_a integer,
    score_b integer,
    played_date date
  ) on commit drop;
  create temporary table if not exists tmp_score_doc_lineups (
    match_id uuid not null,
    side text not null,
    sort_index integer not null,
    player_id uuid not null
  ) on commit drop;

  delete from tmp_score_doc_teams;
  delete from tmp_score_doc_members;
  delete from tmp_score_doc_stages;
  delete from tmp_score_doc_rounds;
  delete from tmp_score_doc_byes;
  delete from tmp_score_doc_matches;
  delete from tmp_score_other_before;
  delete from tmp_score_doc_lineups;

  insert into tmp_score_other_before (id, score_a, score_b, played_date)
  select m.id, m.score_a, m.score_b, m.played_date
  from public.competition_matches m
  where m.competition_id = p_competition_id
    and m.id is distinct from p_match_id;

  v_sort := 0;
  for v_team in
    select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    v_team_id := private.require_uuid(coalesce(v_team ->> 'id', ''), 'team');
    insert into tmp_score_doc_teams (id, sort_index) values (v_team_id, v_sort);
    v_sort := v_sort + 1;
    for v_member in
      select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      insert into tmp_score_doc_members (team_id, player_id, sort_index)
      values (
        v_team_id,
        private.require_uuid(
          coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
          'player'
        ),
        coalesce(
          (select pg_catalog.max(m.sort_index) + 1 from tmp_score_doc_members m where m.team_id = v_team_id),
          0
        )
      );
    end loop;
  end loop;

  for v_stage in
    select value from jsonb_array_elements(coalesce(p_document -> 'stages', '[]'::jsonb))
  loop
    v_stage_id := private.require_uuid(coalesce(v_stage ->> 'id', ''), 'stage');
    select coalesce(array_agg(x::uuid), '{}')
    into v_seed
    from jsonb_array_elements_text(coalesce(v_stage -> 'seedTeamIds', v_stage -> 'seed_team_ids', '[]'::jsonb)) as x;
    v_status := coalesce(v_stage ->> 'status', 'pending');
    if v_status not in ('pending', 'in_progress', 'finished') then
      raise exception using
        errcode = 'P0001',
        message = 'INVALID_PLAN';
    end if;
    insert into tmp_score_doc_stages (
      id, number, name, type, config, seed_team_ids, status, seed_snapshot
    )
    values (
      v_stage_id,
      coalesce((v_stage ->> 'number')::integer, 1),
      nullif(pg_catalog.btrim(coalesce(v_stage ->> 'name', '')), ''),
      coalesce(v_stage ->> 'type', 'single_elimination'),
      coalesce(v_stage -> 'config', '{}'::jsonb),
      coalesce(v_seed, '{}'),
      v_status,
      coalesce(v_stage -> 'seedSnapshot', v_stage -> 'seed_snapshot')
    );

    for v_round in
      select value from jsonb_array_elements(coalesce(v_stage -> 'rounds', '[]'::jsonb))
    loop
      v_round_id := private.require_uuid(coalesce(v_round ->> 'id', ''), 'round');
      insert into tmp_score_doc_rounds (id, stage_id, number, name, bracket)
      values (
        v_round_id,
        v_stage_id,
        coalesce((v_round ->> 'number')::integer, 0),
        nullif(pg_catalog.btrim(coalesce(v_round ->> 'name', '')), ''),
        nullif(v_round ->> 'bracket', '')
      );

      for v_bye in
        select value from jsonb_array_elements(coalesce(v_round -> 'byes', '[]'::jsonb))
      loop
        insert into tmp_score_doc_byes (round_id, team_id)
        values (
          v_round_id,
          private.require_uuid(coalesce(v_bye ->> 'teamId', v_bye ->> 'team_id', ''), 'bye')
        );
      end loop;

      for v_match in
        select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
      loop
        v_match_id := private.require_uuid(coalesce(v_match ->> 'id', ''), 'match');
        insert into tmp_score_doc_matches (
          id, stage_id, round_id, source_a, source_b,
          team_a_id, team_b_id, score_a, score_b, played_date, winner_team_id,
          lineup_a, lineup_b
        )
        values (
          v_match_id,
          v_stage_id,
          v_round_id,
          coalesce(v_match -> 'sourceA', v_match -> 'source_a', '{}'::jsonb),
          coalesce(v_match -> 'sourceB', v_match -> 'source_b', '{}'::jsonb),
          nullif(coalesce(v_match ->> 'teamAId', v_match ->> 'team_a_id'), '')::uuid,
          nullif(coalesce(v_match ->> 'teamBId', v_match ->> 'team_b_id'), '')::uuid,
          private.json_int(v_match, 'scoreA', 'score_a'),
          private.json_int(v_match, 'scoreB', 'score_b'),
          nullif(coalesce(v_match ->> 'playedDate', v_match ->> 'played_date'), '')::date,
          nullif(coalesce(v_match ->> 'winnerTeamId', v_match ->> 'winner_team_id'), '')::uuid,
          coalesce(v_match -> 'lineupA', v_match -> 'lineup_a', '[]'::jsonb),
          coalesce(v_match -> 'lineupB', v_match -> 'lineup_b', '[]'::jsonb)
        );

        v_sort := 0;
        for v_member in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupA', v_match -> 'lineup_a', '[]'::jsonb))
        loop
          insert into tmp_score_doc_lineups (match_id, side, sort_index, player_id)
          values (
            v_match_id,
            'a',
            v_sort,
            private.require_uuid(
              coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
              'lineup'
            )
          );
          v_sort := v_sort + 1;
        end loop;

        v_sort := 0;
        for v_member in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupB', v_match -> 'lineup_b', '[]'::jsonb))
        loop
          insert into tmp_score_doc_lineups (match_id, side, sort_index, player_id)
          values (
            v_match_id,
            'b',
            v_sort,
            private.require_uuid(
              coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
              'lineup'
            )
          );
          v_sort := v_sort + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  if not exists (select 1 from tmp_score_doc_matches d where d.id = p_match_id) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from tmp_score_doc_matches d
    where d.id = p_match_id
      and (
        d.score_a is distinct from p_score_a
        or d.score_b is distinct from p_score_b
        or d.played_date is distinct from p_played_date
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from public.competition_matches m
    join tmp_score_doc_matches d on d.id = m.id
    where m.competition_id = p_competition_id
      and m.id is distinct from p_match_id
      and (
        m.score_a is distinct from d.score_a
        or m.score_b is distinct from d.score_b
        or m.played_date is distinct from d.played_date
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select t.id from public.competition_teams t where t.competition_id = p_competition_id
    except
    select d.id from tmp_score_doc_teams d
  ) or exists (
    select d.id from tmp_score_doc_teams d
    except
    select t.id from public.competition_teams t where t.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select t.id, t.sort_index
    from public.competition_teams t
    where t.competition_id = p_competition_id
    except
    select d.id, d.sort_index from tmp_score_doc_teams d
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select tm.team_id, tm.player_id, tm.sort_index
    from public.competition_team_members tm
    where tm.competition_id = p_competition_id
    except
    select m.team_id, m.player_id, m.sort_index from tmp_score_doc_members m
  ) or exists (
    select m.team_id, m.player_id, m.sort_index from tmp_score_doc_members m
    except
    select tm.team_id, tm.player_id, tm.sort_index
    from public.competition_team_members tm
    where tm.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select s.id from public.competition_stages s where s.competition_id = p_competition_id
    except
    select d.id from tmp_score_doc_stages d
  ) or exists (
    select d.id from tmp_score_doc_stages d
    except
    select s.id from public.competition_stages s where s.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from public.competition_stages s
    join tmp_score_doc_stages d on d.id = s.id
    where s.competition_id = p_competition_id
      and (
        s.number is distinct from d.number
        or s.name is distinct from d.name
        or s.type is distinct from d.type
        or s.config is distinct from d.config
        or s.seed_team_ids is distinct from d.seed_team_ids
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select r.id from public.competition_rounds r where r.competition_id = p_competition_id
    except
    select d.id from tmp_score_doc_rounds d
  ) or exists (
    select d.id from tmp_score_doc_rounds d
    except
    select r.id from public.competition_rounds r where r.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from public.competition_rounds r
    join tmp_score_doc_rounds d on d.id = r.id
    where r.competition_id = p_competition_id
      and (
        r.stage_id is distinct from d.stage_id
        or r.number is distinct from d.number
        or r.name is distinct from d.name
        or r.bracket is distinct from d.bracket
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select b.round_id, b.team_id
    from public.competition_round_byes b
    where b.competition_id = p_competition_id
    except
    select d.round_id, d.team_id from tmp_score_doc_byes d
  ) or exists (
    select d.round_id, d.team_id from tmp_score_doc_byes d
    except
    select b.round_id, b.team_id
    from public.competition_round_byes b
    where b.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select m.id from public.competition_matches m where m.competition_id = p_competition_id
    except
    select d.id from tmp_score_doc_matches d
  ) or exists (
    select d.id from tmp_score_doc_matches d
    except
    select m.id from public.competition_matches m where m.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from public.competition_matches m
    join tmp_score_doc_matches d on d.id = m.id
    where m.competition_id = p_competition_id
      and (
        m.stage_id is distinct from d.stage_id
        or m.round_id is distinct from d.round_id
        or m.source_a is distinct from d.source_a
        or m.source_b is distinct from d.source_b
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from tmp_score_doc_matches d
    where (
        d.team_a_id is not null
        and not exists (
          select 1 from public.competition_teams t
          where t.id = d.team_a_id and t.competition_id = p_competition_id
        )
      )
      or (
        d.team_b_id is not null
        and not exists (
          select 1 from public.competition_teams t
          where t.id = d.team_b_id and t.competition_id = p_competition_id
        )
      )
      or (
        d.winner_team_id is not null
        and d.winner_team_id is distinct from d.team_a_id
        and d.winner_team_id is distinct from d.team_b_id
        and not exists (
          select 1
          from public.competition_matches m
          where m.id = d.id
            and m.competition_id = p_competition_id
            and m.id is distinct from p_match_id
            and (m.score_a is not null or m.score_b is not null or m.played_date is not null)
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if p_score_a is not null then
    if exists (
      select 1
      from public.competition_matches m
      where m.id = p_match_id
        and m.competition_id = p_competition_id
        and (m.team_a_id is null or m.team_b_id is null)
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'COMPETITION_MATCH_TEAMS_UNRESOLVED';
    end if;
  end if;

  if exists (
    select 1
    from public.competition_matches m
    join tmp_score_doc_matches d on d.id = m.id
    where m.competition_id = p_competition_id
      and m.id = p_match_id
      and (
        m.team_a_id is distinct from d.team_a_id
        or m.team_b_id is distinct from d.team_b_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_MATCH_HISTORY_LOCKED';
  end if;

  if exists (
    select mp.side, mp.sort_index, mp.player_id
    from public.competition_match_players mp
    where mp.match_id = p_match_id
      and mp.competition_id = p_competition_id
    except
    select l.side, l.sort_index, l.player_id
    from tmp_score_doc_lineups l
    where l.match_id = p_match_id
  ) or exists (
    select l.side, l.sort_index, l.player_id
    from tmp_score_doc_lineups l
    where l.match_id = p_match_id
    except
    select mp.side, mp.sort_index, mp.player_id
    from public.competition_match_players mp
    where mp.match_id = p_match_id
      and mp.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_MATCH_HISTORY_LOCKED';
  end if;

  if exists (
    select 1
    from public.competition_matches m
    join tmp_score_doc_matches d on d.id = m.id
    where m.competition_id = p_competition_id
      and m.id is distinct from p_match_id
      and (m.score_a is not null or m.score_b is not null or m.played_date is not null)
      and (
        m.team_a_id is distinct from d.team_a_id
        or m.team_b_id is distinct from d.team_b_id
        or m.winner_team_id is distinct from d.winner_team_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_MATCH_HISTORY_LOCKED';
  end if;

  if exists (
    select mp.match_id, mp.side, mp.sort_index, mp.player_id
    from public.competition_match_players mp
    join public.competition_matches m
      on m.id = mp.match_id
     and m.competition_id = mp.competition_id
    where mp.competition_id = p_competition_id
      and m.id is distinct from p_match_id
      and (m.score_a is not null or m.score_b is not null or m.played_date is not null)
    except
    select l.match_id, l.side, l.sort_index, l.player_id
    from tmp_score_doc_lineups l
    join public.competition_matches m
      on m.id = l.match_id
     and m.competition_id = p_competition_id
    where m.id is distinct from p_match_id
      and (m.score_a is not null or m.score_b is not null or m.played_date is not null)
  ) or exists (
    select l.match_id, l.side, l.sort_index, l.player_id
    from tmp_score_doc_lineups l
    join public.competition_matches m
      on m.id = l.match_id
     and m.competition_id = p_competition_id
    where m.id is distinct from p_match_id
      and (m.score_a is not null or m.score_b is not null or m.played_date is not null)
    except
    select mp.match_id, mp.side, mp.sort_index, mp.player_id
    from public.competition_match_players mp
    join public.competition_matches m
      on m.id = mp.match_id
     and m.competition_id = mp.competition_id
    where mp.competition_id = p_competition_id
      and m.id is distinct from p_match_id
      and (m.score_a is not null or m.score_b is not null or m.played_date is not null)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_MATCH_HISTORY_LOCKED';
  end if;

  if exists (
    select 1
    from public.competition_matches m
    join tmp_score_doc_matches d on d.id = m.id
    where m.competition_id = p_competition_id
      and m.id is distinct from p_match_id
      and m.score_a is null
      and m.score_b is null
      and m.played_date is null
      and d.winner_team_id is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_MATCH_HISTORY_LOCKED';
  end if;

  if exists (
    select 1
    from tmp_score_doc_lineups l
    join tmp_score_doc_matches d on d.id = l.match_id
    join public.competition_matches m
      on m.id = d.id
     and m.competition_id = p_competition_id
    where m.id is distinct from p_match_id
      and m.score_a is null
      and m.score_b is null
      and m.played_date is null
      and (
        (
          l.side = 'a'
          and (
            d.team_a_id is null
            or not exists (
              select 1
              from public.competition_team_members tm
              where tm.competition_id = p_competition_id
                and tm.team_id = d.team_a_id
                and tm.player_id = l.player_id
            )
          )
        )
        or (
          l.side = 'b'
          and (
            d.team_b_id is null
            or not exists (
              select 1
              from public.competition_team_members tm
              where tm.competition_id = p_competition_id
                and tm.team_id = d.team_b_id
                and tm.player_id = l.player_id
            )
          )
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  -- Stage status/seed_snapshot stay as persisted. Structure RPC owns those fields.

  update public.competition_matches m
  set
    winner_team_id = case
      when p_score_a is null then null
      when p_score_a > p_score_b then m.team_a_id
      else m.team_b_id
    end,
    score_a = p_score_a,
    score_b = p_score_b,
    played_date = p_played_date
  where m.id = p_match_id
    and m.competition_id = p_competition_id;

  for v_row in
    select d.*, m.score_a as persist_score_a, m.score_b as persist_score_b, m.played_date as persist_played
    from tmp_score_doc_matches d
    join public.competition_matches m
      on m.id = d.id
     and m.competition_id = p_competition_id
    where d.id is distinct from p_match_id
      and m.score_a is null
      and m.score_b is null
      and m.played_date is null
  loop
    v_match_id := v_row.id;
    v_team_a := v_row.team_a_id;
    v_team_b := v_row.team_b_id;

    update public.competition_matches
    set
      team_a_id = v_team_a,
      team_b_id = v_team_b,
      winner_team_id = null
    where id = v_match_id
      and competition_id = p_competition_id;

    delete from public.competition_match_players
    where match_id = v_match_id
      and competition_id = p_competition_id;

    if v_team_a is not null then
      insert into public.competition_match_players (
        match_id, competition_id, player_id, side, sort_index, player_name_snapshot
      )
      select
        v_match_id,
        p_competition_id,
        tm.player_id,
        'a',
        tm.sort_index,
        tm.player_name_snapshot
      from public.competition_team_members tm
      where tm.competition_id = p_competition_id
        and tm.team_id = v_team_a
      order by tm.sort_index, tm.player_id;
    end if;

    if v_team_b is not null then
      insert into public.competition_match_players (
        match_id, competition_id, player_id, side, sort_index, player_name_snapshot
      )
      select
        v_match_id,
        p_competition_id,
        tm.player_id,
        'b',
        tm.sort_index,
        tm.player_name_snapshot
      from public.competition_team_members tm
      where tm.competition_id = p_competition_id
        and tm.team_id = v_team_b
      order by tm.sort_index, tm.player_id;
    end if;
  end loop;

  if exists (
    select 1
    from public.competition_matches m
    where m.id = p_match_id
      and m.competition_id = p_competition_id
      and (
        m.score_a is distinct from p_score_a
        or m.score_b is distinct from p_score_b
        or m.played_date is distinct from p_played_date
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if exists (
    select 1
    from tmp_score_other_before b
    join public.competition_matches m
      on m.id = b.id
     and m.competition_id = p_competition_id
    where m.score_a is distinct from b.score_a
      or m.score_b is distinct from b.score_b
      or m.played_date is distinct from b.played_date
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;
exception
  when invalid_text_representation then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
end;
$$;

create or replace function private.ensure_competition_player(
  p_competition_id uuid,
  p_player_id uuid,
  p_name text,
  p_sort integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_player_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;
  if not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_NOT_FOUND';
  end if;
  v_name := coalesce(nullif(pg_catalog.btrim(coalesce(p_name, '')), ''), 'Jogador');
  insert into public.competition_players (competition_id, player_id, player_name_snapshot, sort_index)
  values (p_competition_id, p_player_id, v_name, p_sort)
  on conflict (competition_id, player_id) do update
    set player_name_snapshot = excluded.player_name_snapshot;
end;
$$;

create or replace function private.replace_competition_graph(
  p_competition_id uuid,
  p_document jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team jsonb;
  v_member jsonb;
  v_stage jsonb;
  v_round jsonb;
  v_match jsonb;
  v_bye jsonb;
  v_team_id uuid;
  v_player_id uuid;
  v_stage_id uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_sort integer;
  v_member_sort integer;
  v_round_sort integer;
  v_name text;
  v_status text;
  v_seed uuid[];
begin
  if jsonb_typeof(p_document) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  v_status := coalesce(nullif(pg_catalog.btrim(p_document ->> 'status'), ''), 'draft');
  if v_status = 'finished' then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_STATUS_FORBIDDEN';
  end if;
  if v_status not in ('draft', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;
  if exists (
    select 1
    from public.competitions c
    where c.id = p_competition_id
      and c.status = 'in_progress'
      and v_status = 'draft'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_STATUS_FORBIDDEN';
  end if;

  select coalesce(array_agg(x::uuid), '{}')
  into v_seed
  from jsonb_array_elements_text(coalesce(p_document -> 'seedTeamIds', p_document -> 'seed_team_ids', '[]'::jsonb)) as x;

  update public.competitions
  set
    name = nullif(pg_catalog.btrim(coalesce(p_document ->> 'name', '')), ''),
    date = coalesce((p_document ->> 'date')::date, date),
    status = v_status,
    format_team_size = coalesce(
      (p_document #>> '{format,teamSize}')::integer,
      (p_document ->> 'format_team_size')::integer,
      format_team_size
    ),
    seed_team_ids = coalesce(v_seed, '{}')
  where id = p_competition_id;

  create temporary table if not exists tmp_graph_incoming_matches (
    id uuid primary key,
    score_a integer,
    score_b integer,
    played_date date,
    winner_team_id uuid
  ) on commit drop;
  create temporary table if not exists tmp_graph_match_persist (
    id uuid primary key,
    version bigint not null,
    score_a integer,
    score_b integer,
    played_date date,
    winner_team_id uuid,
    team_a_id uuid,
    team_b_id uuid,
    updated_by uuid,
    updated_at timestamptz,
    had_score boolean not null
  ) on commit drop;
  create temporary table if not exists tmp_graph_player_persist (
    match_id uuid not null,
    competition_id uuid not null,
    player_id uuid not null,
    side text not null,
    sort_index integer not null,
    player_name_snapshot text not null
  ) on commit drop;
  create temporary table if not exists tmp_competition_match_events (
    like public.competition_match_events including defaults
  ) on commit drop;

  delete from tmp_graph_incoming_matches;
  delete from tmp_graph_match_persist;
  delete from tmp_graph_player_persist;
  delete from tmp_competition_match_events;

  for v_stage in
    select value from jsonb_array_elements(coalesce(p_document -> 'stages', '[]'::jsonb))
  loop
    for v_round in
      select value from jsonb_array_elements(coalesce(v_stage -> 'rounds', '[]'::jsonb))
    loop
      for v_match in
        select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
      loop
        insert into tmp_graph_incoming_matches (
          id, score_a, score_b, played_date, winner_team_id
        )
        values (
          private.require_uuid(coalesce(v_match ->> 'id', ''), 'match'),
          private.json_int(v_match, 'scoreA', 'score_a'),
          private.json_int(v_match, 'scoreB', 'score_b'),
          nullif(coalesce(v_match ->> 'playedDate', v_match ->> 'played_date'), '')::date,
          nullif(coalesce(v_match ->> 'winnerTeamId', v_match ->> 'winner_team_id'), '')::uuid
        );
      end loop;
    end loop;
  end loop;

  if exists (
    select 1
    from public.competition_matches m
    where m.competition_id = p_competition_id
      and not exists (select 1 from tmp_graph_incoming_matches i where i.id = m.id)
      and (
        m.score_a is not null
        or m.score_b is not null
        or m.played_date is not null
        or exists (
          select 1
          from public.competition_match_events e
          where e.match_id = m.id
            and e.competition_id = m.competition_id
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_MATCH_HAS_HISTORY';
  end if;

  if exists (
    select 1
    from public.competition_matches m
    join tmp_graph_incoming_matches i on i.id = m.id
    where m.competition_id = p_competition_id
      and (
        m.score_a is distinct from i.score_a
        or m.score_b is distinct from i.score_b
        or m.played_date is distinct from i.played_date
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_SCORE_IMMUTABLE';
  end if;

  if exists (
    select 1
    from tmp_graph_incoming_matches i
    where not exists (
      select 1
      from public.competition_matches m
      where m.id = i.id
        and m.competition_id = p_competition_id
    )
      and (
        i.score_a is not null
        or i.score_b is not null
        or i.played_date is not null
        or i.winner_team_id is not null
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_SCORE_IMMUTABLE';
  end if;

  insert into tmp_graph_match_persist (
    id, version, score_a, score_b, played_date, winner_team_id,
    team_a_id, team_b_id, updated_by, updated_at, had_score
  )
  select
    m.id,
    m.version,
    m.score_a,
    m.score_b,
    m.played_date,
    m.winner_team_id,
    m.team_a_id,
    m.team_b_id,
    m.updated_by,
    m.updated_at,
    (m.score_a is not null or m.score_b is not null or m.played_date is not null)
  from public.competition_matches m
  where m.competition_id = p_competition_id;

  insert into tmp_graph_player_persist (
    match_id, competition_id, player_id, side, sort_index, player_name_snapshot
  )
  select mp.match_id, mp.competition_id, mp.player_id, mp.side, mp.sort_index, mp.player_name_snapshot
  from public.competition_match_players mp
  join tmp_graph_match_persist s on s.id = mp.match_id
  where mp.competition_id = p_competition_id
    and s.had_score;

  insert into tmp_competition_match_events
  select * from public.competition_match_events
  where competition_id = p_competition_id;

  delete from public.competition_match_events where competition_id = p_competition_id;
  delete from public.competition_match_players where competition_id = p_competition_id;
  delete from public.competition_matches where competition_id = p_competition_id;
  delete from public.competition_round_byes where competition_id = p_competition_id;
  delete from public.competition_rounds where competition_id = p_competition_id;
  delete from public.competition_stages where competition_id = p_competition_id;
  delete from public.competition_team_members where competition_id = p_competition_id;
  delete from public.competition_teams where competition_id = p_competition_id;
  delete from public.competition_players where competition_id = p_competition_id;

  v_sort := 0;
  for v_team in
    select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    for v_member in
      select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      v_player_id := private.require_uuid(
        coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
        'player'
      );
      perform private.ensure_competition_player(
        p_competition_id,
        v_player_id,
        coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot'),
        v_sort
      );
      v_sort := v_sort + 1;
    end loop;
  end loop;

  v_sort := 0;
  for v_team in
    select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    v_team_id := private.require_uuid(coalesce(v_team ->> 'id', ''), 'team');
    insert into public.competition_teams (id, competition_id, sort_index)
    values (v_team_id, p_competition_id, v_sort);
    v_member_sort := 0;
    for v_member in
      select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      v_player_id := private.require_uuid(
        coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
        'player'
      );
      v_name := coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', 'Jogador');
      insert into public.competition_team_members (
        team_id, competition_id, player_id, player_name_snapshot, sort_index
      )
      values (v_team_id, p_competition_id, v_player_id, v_name, v_member_sort);
      v_member_sort := v_member_sort + 1;
    end loop;
    v_sort := v_sort + 1;
  end loop;

  for v_stage in
    select value from jsonb_array_elements(coalesce(p_document -> 'stages', '[]'::jsonb))
  loop
    v_stage_id := private.require_uuid(coalesce(v_stage ->> 'id', ''), 'stage');
    select coalesce(array_agg(x::uuid), '{}')
    into v_seed
    from jsonb_array_elements_text(coalesce(v_stage -> 'seedTeamIds', v_stage -> 'seed_team_ids', '[]'::jsonb)) as x;

    insert into public.competition_stages (
      id, competition_id, number, name, type, status, config, seed_team_ids, seed_snapshot
    )
    values (
      v_stage_id,
      p_competition_id,
      coalesce((v_stage ->> 'number')::integer, 1),
      nullif(pg_catalog.btrim(coalesce(v_stage ->> 'name', '')), ''),
      coalesce(v_stage ->> 'type', 'single_elimination'),
      coalesce(v_stage ->> 'status', 'pending'),
      coalesce(v_stage -> 'config', '{}'::jsonb),
      coalesce(v_seed, '{}'),
      v_stage -> 'seedSnapshot'
    );

    v_round_sort := 0;
    for v_round in
      select value from jsonb_array_elements(coalesce(v_stage -> 'rounds', '[]'::jsonb))
    loop
      v_round_id := private.require_uuid(coalesce(v_round ->> 'id', ''), 'round');
      insert into public.competition_rounds (
        id, competition_id, stage_id, number, name, bracket
      )
      values (
        v_round_id,
        p_competition_id,
        v_stage_id,
        coalesce((v_round ->> 'number')::integer, v_round_sort + 1),
        nullif(pg_catalog.btrim(coalesce(v_round ->> 'name', '')), ''),
        nullif(v_round ->> 'bracket', '')
      );

      for v_bye in
        select value from jsonb_array_elements(coalesce(v_round -> 'byes', '[]'::jsonb))
      loop
        insert into public.competition_round_byes (round_id, competition_id, team_id)
        values (
          v_round_id,
          p_competition_id,
          private.require_uuid(coalesce(v_bye ->> 'teamId', v_bye ->> 'team_id', ''), 'bye')
        );
      end loop;

      for v_match in
        select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
      loop
        v_match_id := private.require_uuid(coalesce(v_match ->> 'id', ''), 'match');
        insert into public.competition_matches (
          id, competition_id, stage_id, round_id,
          source_a, source_b, team_a_id, team_b_id,
          score_a, score_b, played_date, winner_team_id
        )
        values (
          v_match_id,
          p_competition_id,
          v_stage_id,
          v_round_id,
          coalesce(v_match -> 'sourceA', v_match -> 'source_a', '{}'::jsonb),
          coalesce(v_match -> 'sourceB', v_match -> 'source_b', '{}'::jsonb),
          nullif(coalesce(v_match ->> 'teamAId', v_match ->> 'team_a_id'), '')::uuid,
          nullif(coalesce(v_match ->> 'teamBId', v_match ->> 'team_b_id'), '')::uuid,
          nullif(coalesce(v_match ->> 'scoreA', v_match ->> 'score_a'), '')::integer,
          nullif(coalesce(v_match ->> 'scoreB', v_match ->> 'score_b'), '')::integer,
          nullif(coalesce(v_match ->> 'playedDate', v_match ->> 'played_date'), '')::date,
          nullif(coalesce(v_match ->> 'winnerTeamId', v_match ->> 'winner_team_id'), '')::uuid
        );

        v_member_sort := 0;
        for v_member in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupA', v_match -> 'lineup_a', '[]'::jsonb))
        loop
          v_player_id := private.require_uuid(
            coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
            'lineup'
          );
          v_name := coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', 'Jogador');
          perform private.ensure_competition_player(p_competition_id, v_player_id, v_name, 1000 + v_member_sort);
          insert into public.competition_match_players (
            match_id, competition_id, player_id, side, sort_index, player_name_snapshot
          )
          values (v_match_id, p_competition_id, v_player_id, 'a', v_member_sort, v_name);
          v_member_sort := v_member_sort + 1;
        end loop;

        v_member_sort := 0;
        for v_member in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupB', v_match -> 'lineup_b', '[]'::jsonb))
        loop
          v_player_id := private.require_uuid(
            coalesce(private.json_text(v_member, 'playerId', 'player_id'), ''),
            'lineup'
          );
          v_name := coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', 'Jogador');
          perform private.ensure_competition_player(p_competition_id, v_player_id, v_name, 2000 + v_member_sort);
          insert into public.competition_match_players (
            match_id, competition_id, player_id, side, sort_index, player_name_snapshot
          )
          values (v_match_id, p_competition_id, v_player_id, 'b', v_member_sort, v_name);
          v_member_sort := v_member_sort + 1;
        end loop;
      end loop;
      v_round_sort := v_round_sort + 1;
    end loop;
  end loop;

  update public.competition_matches m
  set
    version = s.version,
    score_a = s.score_a,
    score_b = s.score_b,
    played_date = s.played_date,
    winner_team_id = s.winner_team_id,
    updated_by = s.updated_by,
    updated_at = s.updated_at,
    team_a_id = case when s.had_score then s.team_a_id else m.team_a_id end,
    team_b_id = case when s.had_score then s.team_b_id else m.team_b_id end
  from tmp_graph_match_persist s
  where m.id = s.id
    and m.competition_id = p_competition_id;

  update public.competition_matches m
  set
    version = 0,
    score_a = null,
    score_b = null,
    played_date = null,
    winner_team_id = null
  where m.competition_id = p_competition_id
    and not exists (select 1 from tmp_graph_match_persist s where s.id = m.id);

  delete from public.competition_match_players mp
  using tmp_graph_match_persist s
  where mp.match_id = s.id
    and mp.competition_id = p_competition_id
    and s.had_score;

  insert into public.competition_match_players (
    match_id, competition_id, player_id, side, sort_index, player_name_snapshot
  )
  select
    p.match_id, p.competition_id, p.player_id, p.side, p.sort_index, p.player_name_snapshot
  from tmp_graph_player_persist p;

  insert into public.competition_match_events (
    id, competition_id, match_id, user_id, event_type,
    old_score_a, old_score_b, new_score_a, new_score_b,
    match_version_before, match_version_after, created_at
  )
  select
    e.id, e.competition_id, e.match_id, e.user_id, e.event_type,
    e.old_score_a, e.old_score_b, e.new_score_a, e.new_score_b,
    e.match_version_before, e.match_version_after, e.created_at
  from tmp_competition_match_events e
  where exists (
    select 1
    from public.competition_matches m
    where m.id = e.match_id
      and m.competition_id = e.competition_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function private.prepare_new_competition()
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
  return new;
end;
$$;

create or replace function private.add_competition_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.competition_members (competition_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create or replace function private.protect_competition_audit_fields()
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
  if new.group_id is distinct from old.group_id then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_ID_IMMUTABLE';
  end if;
  if new.join_code is distinct from old.join_code
     and current_setting('private.allow_competition_join_code_rotate', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_JOIN_CODE_ROTATE_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists competitions_set_updated_at on public.competitions;
create trigger competitions_set_updated_at
  before update on public.competitions
  for each row execute function private.set_updated_at();

drop trigger if exists competitions_prepare_insert on public.competitions;
create trigger competitions_prepare_insert
  before insert on public.competitions
  for each row execute function private.prepare_new_competition();

drop trigger if exists competitions_add_owner on public.competitions;
create trigger competitions_add_owner
  after insert on public.competitions
  for each row execute function private.add_competition_owner();

drop trigger if exists competitions_protect_audit on public.competitions;
create trigger competitions_protect_audit
  before update on public.competitions
  for each row execute function private.protect_competition_audit_fields();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_competition(
  p_name text,
  p_date date,
  p_format_team_size integer,
  p_group_id uuid default null,
  p_stages jsonb default null
)
returns public.competitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_competition public.competitions;
  v_attempt integer;
  v_stage jsonb;
  v_index integer := 0;
  v_stages jsonb;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if p_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if p_format_team_size is null or p_format_team_size < 2 or p_format_team_size > 6 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  if p_group_id is not null and not private.is_group_member(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  v_stages := coalesce(p_stages, '[{"type":"single_elimination","config":{}}]'::jsonb);
  if jsonb_typeof(v_stages) is distinct from 'array' or jsonb_array_length(v_stages) < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  for v_attempt in 1..8 loop
    begin
      insert into public.competitions (created_by, group_id, name, date, format_team_size)
      values (v_uid, p_group_id, nullif(pg_catalog.btrim(coalesce(p_name, '')), ''), p_date, p_format_team_size)
      returning * into v_competition;

      for v_stage in select value from jsonb_array_elements(v_stages)
      loop
        v_index := v_index + 1;
        insert into public.competition_stages (
          id, competition_id, number, name, type, status, config
        )
        values (
          coalesce(nullif(v_stage ->> 'id', '')::uuid, pg_catalog.gen_random_uuid()),
          v_competition.id,
          coalesce((v_stage ->> 'number')::integer, v_index),
          nullif(pg_catalog.btrim(coalesce(v_stage ->> 'name', '')), ''),
          coalesce(v_stage ->> 'type', 'single_elimination'),
          'pending',
          coalesce(v_stage -> 'config', '{}'::jsonb)
        );
      end loop;

      return v_competition;
    exception
      when unique_violation then
        if v_attempt = 8 then
          raise exception using
            errcode = 'P0001',
            message = 'JOIN_CODE_GENERATION_FAILED';
        end if;
        v_index := 0;
    end;
  end loop;
end;
$$;

create or replace function public.join_competition_by_code(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
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

  select c.id into v_id
  from public.competitions c
  where c.join_code = v_code;

  if v_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'COMPETITION_JOIN_CODE_NOT_FOUND';
  end if;

  insert into public.competition_members (competition_id, user_id, role)
  values (v_id, v_uid, 'member')
  on conflict (competition_id, user_id) do nothing;

  return v_id;
end;
$$;

create or replace function public.rotate_competition_join_code(p_competition_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_attempt integer;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if not private.can_manage_competition(p_competition_id) then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_JOIN_CODE_ROTATE_FORBIDDEN';
  end if;

  for v_attempt in 1..8 loop
    begin
      v_code := private.generate_join_code();
      perform set_config('private.allow_competition_join_code_rotate', 'true', true);
      update public.competitions
      set join_code = v_code
      where id = p_competition_id;
      return v_code;
    exception
      when unique_violation then
        if v_attempt = 8 then
          raise exception using
            errcode = 'P0001',
            message = 'JOIN_CODE_GENERATION_FAILED';
        end if;
    end;
  end loop;
end;
$$;

create or replace function public.replace_competition_teams(
  p_competition_id uuid,
  p_expected_structure_version bigint,
  p_teams jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competition public.competitions;
  v_document jsonb;
begin
  v_competition := private.lock_competition_structure(p_competition_id, p_expected_structure_version);

  if not private.can_manage_competition(p_competition_id) then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_FORBIDDEN';
  end if;

  if v_competition.status is distinct from 'draft' then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_NOT_DRAFT';
  end if;

  if exists (
    select 1
    from public.competition_rounds r
    where r.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_TEAMS_LOCKED';
  end if;

  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  v_document := jsonb_build_object(
    'status', v_competition.status,
    'name', v_competition.name,
    'date', v_competition.date,
    'format', jsonb_build_object('teamSize', v_competition.format_team_size),
    'seedTeamIds', to_jsonb(v_competition.seed_team_ids),
    'teams', p_teams,
    'stages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'number', s.number,
            'name', s.name,
            'type', s.type,
            'status', s.status,
            'config', s.config,
            'seedTeamIds', to_jsonb(s.seed_team_ids),
            'seedSnapshot', s.seed_snapshot,
            'rounds', '[]'::jsonb
          )
          order by s.number
        )
        from public.competition_stages s
        where s.competition_id = p_competition_id
      ),
      '[]'::jsonb
    )
  );

  perform private.replace_competition_graph(p_competition_id, v_document);
  return private.bump_competition_structure_version(p_competition_id);
end;
$$;

create or replace function public.save_competition_structure(
  p_competition_id uuid,
  p_expected_structure_version bigint,
  p_document jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competition public.competitions;
  v_doc_status text;
begin
  v_competition := private.lock_competition_structure(p_competition_id, p_expected_structure_version);

  if not private.can_manage_competition(p_competition_id) then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_FORBIDDEN';
  end if;

  if v_competition.status = 'finished' then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_FINISHED';
  end if;

  if jsonb_typeof(p_document) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  v_doc_status := coalesce(
    nullif(pg_catalog.btrim(p_document ->> 'status'), ''),
    v_competition.status
  );
  if v_doc_status = 'finished' then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_STATUS_FORBIDDEN';
  end if;
  if v_competition.status = 'in_progress' and v_doc_status is distinct from 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_STATUS_FORBIDDEN';
  end if;
  if v_competition.status = 'draft' and v_doc_status not in ('draft', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_STATUS_FORBIDDEN';
  end if;

  p_document := p_document || jsonb_build_object('status', v_doc_status);
  perform private.replace_competition_graph(p_competition_id, p_document);
  return private.bump_competition_structure_version(p_competition_id);
end;
$$;

create or replace function public.set_competition_match_score(
  p_competition_id uuid,
  p_match_id uuid,
  p_score_a integer,
  p_score_b integer,
  p_played_date date,
  p_expected_version bigint,
  p_expected_structure_version bigint,
  p_document jsonb
)
returns public.competition_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_competition public.competitions;
  v_before public.competition_matches;
  v_updated public.competition_matches;
  v_event text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_competition
  from public.competitions
  where id = p_competition_id
  for update;

  if v_competition.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'COMPETITION_NOT_FOUND';
  end if;

  select * into v_before
  from public.competition_matches
  where id = p_match_id
    and competition_id = p_competition_id
  for update;

  if v_before.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'COMPETITION_MATCH_NOT_FOUND';
  end if;

  if v_before.version is distinct from p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'SCORE_VERSION_CONFLICT';
  end if;

  if v_competition.structure_version is distinct from p_expected_structure_version then
    raise exception using
      errcode = '40001',
      message = 'COMPETITION_STRUCTURE_VERSION_CONFLICT';
  end if;

  v_role := private.competition_role(p_competition_id);

  if v_role is null or v_role = 'viewer' then
    raise exception using
      errcode = '42501',
      message = 'SCORE_FORBIDDEN';
  end if;

  if v_competition.status not in ('in_progress', 'finished') then
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
    if v_competition.status is distinct from 'in_progress' or v_role not in ('owner', 'admin') then
      raise exception using
        errcode = '42501',
        message = 'SCORE_CLEAR_FORBIDDEN';
    end if;
    v_event := 'clear_score';
  else
    if v_competition.status = 'finished' and v_role not in ('owner', 'admin') then
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

  perform private.apply_competition_score_document(
    p_competition_id,
    p_match_id,
    p_score_a,
    p_score_b,
    p_played_date,
    p_document
  );

  update public.competition_matches
  set
    version = version + 1,
    updated_by = v_uid,
    updated_at = pg_catalog.now()
  where id = p_match_id
    and competition_id = p_competition_id
  returning * into v_updated;

  if v_updated.score_a is distinct from p_score_a
     or v_updated.score_b is distinct from p_score_b
     or v_updated.played_date is distinct from p_played_date
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PLAN';
  end if;

  insert into public.competition_match_events (
    competition_id, match_id, user_id, event_type,
    old_score_a, old_score_b, new_score_a, new_score_b,
    match_version_before, match_version_after
  )
  values (
    p_competition_id,
    p_match_id,
    v_uid,
    v_event,
    v_before.score_a,
    v_before.score_b,
    v_updated.score_a,
    v_updated.score_b,
    v_before.version,
    v_updated.version
  );

  perform private.bump_competition_structure_version(p_competition_id);
  return v_updated;
end;
$$;

create or replace function public.finalize_competition(
  p_competition_id uuid,
  p_expected_structure_version bigint
)
returns public.competitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competition public.competitions;
begin
  v_competition := private.lock_competition_structure(p_competition_id, p_expected_structure_version);

  if not private.can_manage_competition(p_competition_id) then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_FORBIDDEN';
  end if;

  if v_competition.status = 'finished' then
    return v_competition;
  end if;

  if not exists (
    select 1 from public.competition_matches m where m.competition_id = p_competition_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FINALIZE_NO_MATCHES';
  end if;

  -- Unplayed bracket slots keep null teams; only assigned matches must have scores.
  -- Champion/standings stay in the JS domain.
  if exists (
    select 1
    from public.competition_matches m
    where m.competition_id = p_competition_id
      and m.team_a_id is not null
      and m.team_b_id is not null
      and (m.score_a is null or m.score_b is null)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FINALIZE_INCOMPLETE';
  end if;

  update public.competitions
  set
    status = 'finished',
    structure_version = structure_version + 1
  where id = p_competition_id
  returning * into v_competition;

  return v_competition;
end;
$$;

create or replace function public.set_competition_member_role(
  p_competition_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_target text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if p_role not in ('admin', 'member', 'viewer') then
    raise exception using
      errcode = 'P0001',
      message = 'COMPETITION_ROLE_INVALID';
  end if;

  v_actor := private.competition_role(p_competition_id);
  if v_actor not in ('owner', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_FORBIDDEN';
  end if;

  select cm.role into v_target
  from public.competition_members cm
  where cm.competition_id = p_competition_id
    and cm.user_id = p_user_id;

  if v_target is null then
    raise exception using
      errcode = 'P0002',
      message = 'COMPETITION_MEMBER_NOT_FOUND';
  end if;

  if v_target = 'owner' then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_OWNER_IMMUTABLE';
  end if;

  if v_actor = 'admin' and v_target = 'admin' and p_role is distinct from 'member' and p_role is distinct from 'viewer' then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_ROLE_FORBIDDEN';
  end if;

  update public.competition_members
  set role = p_role
  where competition_id = p_competition_id
    and user_id = p_user_id;
end;
$$;

create or replace function public.remove_competition_member(
  p_competition_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_target text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_actor := private.competition_role(p_competition_id);
  select cm.role into v_target
  from public.competition_members cm
  where cm.competition_id = p_competition_id
    and cm.user_id = p_user_id;

  if v_target is null then
    raise exception using
      errcode = 'P0002',
      message = 'COMPETITION_MEMBER_NOT_FOUND';
  end if;

  if v_target = 'owner' then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_OWNER_IMMUTABLE';
  end if;

  if auth.uid() is distinct from p_user_id and v_actor not in ('owner', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_FORBIDDEN';
  end if;

  if v_actor = 'admin' and v_target = 'admin' and auth.uid() is distinct from p_user_id then
    raise exception using
      errcode = '42501',
      message = 'COMPETITION_ROLE_FORBIDDEN';
  end if;

  delete from public.competition_members
  where competition_id = p_competition_id
    and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Performance RPCs: sessions + competitions (metrics stay in JS)
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
        select jsonb_agg(payload order by sort_date desc, source_key, round_number, match_id)
        from (
          select
            s.date as sort_date,
            ('session:' || s.id::text) as source_key,
            r.number as round_number,
            m.id as match_id,
            jsonb_build_object(
              'source_kind', 'session',
              'match_id', m.id,
              'session_id', s.id,
              'competition_id', null,
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
          left join public.match_players mp on mp.match_id = m.id
          where exists (
            select 1
            from public.match_players mine
            where mine.player_id = v_player.id
              and mine.match_id = m.id
          )
          group by
            m.id, m.score_a, m.score_b, s.id, s.date, s.name, s.updated_at, s.created_at,
            s.legacy_source_id, r.id, r.number, r.cycle_number
          union all
          select
            coalesce(cm.played_date, c.date) as sort_date,
            ('competition:' || c.id::text) as source_key,
            cr.number as round_number,
            cm.id as match_id,
            jsonb_build_object(
              'source_kind', 'competition',
              'match_id', cm.id,
              'session_id', null,
              'competition_id', c.id,
              'session_name', c.name,
              'session_date', coalesce(cm.played_date, c.date),
              'session_updated_at', c.updated_at,
              'session_created_at', c.created_at,
              'legacy_source_id', c.legacy_source_id,
              'round_id', cr.id,
              'round_number', cr.number,
              'cycle_number', null,
              'score_a', cm.score_a,
              'score_b', cm.score_b,
              'lineup_a', coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'player_id', cmp.player_id,
                    'player_name_snapshot', cmp.player_name_snapshot,
                    'sort_index', cmp.sort_index
                  )
                  order by cmp.sort_index, cmp.player_id
                ) filter (where cmp.side = 'a'),
                '[]'::jsonb
              ),
              'lineup_b', coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'player_id', cmp.player_id,
                    'player_name_snapshot', cmp.player_name_snapshot,
                    'sort_index', cmp.sort_index
                  )
                  order by cmp.sort_index, cmp.player_id
                ) filter (where cmp.side = 'b'),
                '[]'::jsonb
              )
            ) as payload
          from public.competition_matches cm
          join public.competition_rounds cr on cr.id = cm.round_id
          join public.competitions c on c.id = cm.competition_id
          left join public.competition_match_players cmp on cmp.match_id = cm.id
          where exists (
            select 1
            from public.competition_match_players mine
            where mine.player_id = v_player.id
              and mine.match_id = cm.id
          )
          group by
            cm.id, cm.score_a, cm.score_b, cm.played_date, c.id, c.date, c.name, c.updated_at,
            c.created_at, c.legacy_source_id, cr.id, cr.number
        ) grouped
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_group_performance_matches(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select exists (
    select 1 from public.groups g where g.id = p_group_id
  ) into v_exists;

  if not v_exists then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_NOT_FOUND';
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  return jsonb_build_object(
    'group_id', p_group_id,
    'members',
    coalesce(
      (
        select jsonb_agg(member_row order by role_rank, display_name, user_id)
        from (
          select
            gm.user_id,
            coalesce(p.display_name, '') as display_name,
            gm.role,
            case gm.role
              when 'owner' then 0
              when 'admin' then 1
              else 2
            end as role_rank,
            jsonb_build_object(
              'user_id', gm.user_id,
              'display_name', coalesce(p.display_name, ''),
              'role', gm.role,
              'player_id', pl.id,
              'player_name', pl.name
            ) as member_row
          from public.group_members gm
          inner join public.profiles p on p.id = gm.user_id
          left join public.players pl on pl.linked_user_id = gm.user_id
          where gm.group_id = p_group_id
        ) members
      ),
      '[]'::jsonb
    ),
    'matches',
    coalesce(
      (
        select jsonb_agg(payload order by sort_date desc, source_key, round_number, match_id)
        from (
          select
            s.date as sort_date,
            ('session:' || s.id::text) as source_key,
            r.number as round_number,
            m.id as match_id,
            jsonb_build_object(
              'source_kind', 'session',
              'match_id', m.id,
              'session_id', s.id,
              'competition_id', null,
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
          left join public.match_players mp on mp.match_id = m.id
          where s.group_id = p_group_id
          group by
            m.id, m.score_a, m.score_b, s.id, s.date, s.name, s.updated_at, s.created_at,
            s.legacy_source_id, r.id, r.number, r.cycle_number
          union all
          select
            coalesce(cm.played_date, c.date) as sort_date,
            ('competition:' || c.id::text) as source_key,
            cr.number as round_number,
            cm.id as match_id,
            jsonb_build_object(
              'source_kind', 'competition',
              'match_id', cm.id,
              'session_id', null,
              'competition_id', c.id,
              'session_name', c.name,
              'session_date', coalesce(cm.played_date, c.date),
              'session_updated_at', c.updated_at,
              'session_created_at', c.created_at,
              'legacy_source_id', c.legacy_source_id,
              'round_id', cr.id,
              'round_number', cr.number,
              'cycle_number', null,
              'score_a', cm.score_a,
              'score_b', cm.score_b,
              'lineup_a', coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'player_id', cmp.player_id,
                    'player_name_snapshot', cmp.player_name_snapshot,
                    'sort_index', cmp.sort_index
                  )
                  order by cmp.sort_index, cmp.player_id
                ) filter (where cmp.side = 'a'),
                '[]'::jsonb
              ),
              'lineup_b', coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'player_id', cmp.player_id,
                    'player_name_snapshot', cmp.player_name_snapshot,
                    'sort_index', cmp.sort_index
                  )
                  order by cmp.sort_index, cmp.player_id
                ) filter (where cmp.side = 'b'),
                '[]'::jsonb
              )
            ) as payload
          from public.competition_matches cm
          join public.competition_rounds cr on cr.id = cm.round_id
          join public.competitions c on c.id = cm.competition_id
          left join public.competition_match_players cmp on cmp.match_id = cm.id
          where c.group_id = p_group_id
          group by
            cm.id, cm.score_a, cm.score_b, cm.played_date, c.id, c.date, c.name, c.updated_at,
            c.created_at, c.legacy_source_id, cr.id, cr.number
        ) grouped
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants / RLS
-- ---------------------------------------------------------------------------
revoke all on function private.competition_role(uuid) from public;
revoke all on function private.competition_role(uuid) from anon;
revoke all on function private.competition_role(uuid) from authenticated;
revoke all on function private.is_competition_member(uuid) from public;
revoke all on function private.is_competition_member(uuid) from anon;
revoke all on function private.can_manage_competition(uuid) from public;
revoke all on function private.can_manage_competition(uuid) from anon;
revoke all on function private.can_manage_competition(uuid) from authenticated;
revoke all on function private.shares_competition_with(uuid) from public;
revoke all on function private.shares_competition_with(uuid) from anon;
revoke all on function private.shares_group_with(uuid) from public;
revoke all on function private.shares_group_with(uuid) from anon;
revoke all on function private.lock_competition_structure(uuid, bigint) from public;
revoke all on function private.lock_competition_structure(uuid, bigint) from anon;
revoke all on function private.lock_competition_structure(uuid, bigint) from authenticated;
revoke all on function private.bump_competition_structure_version(uuid) from public;
revoke all on function private.bump_competition_structure_version(uuid) from anon;
revoke all on function private.bump_competition_structure_version(uuid) from authenticated;
revoke all on function private.json_text(jsonb, text, text) from public;
revoke all on function private.json_text(jsonb, text, text) from anon;
revoke all on function private.json_text(jsonb, text, text) from authenticated;
revoke all on function private.json_int(jsonb, text, text) from public;
revoke all on function private.json_int(jsonb, text, text) from anon;
revoke all on function private.json_int(jsonb, text, text) from authenticated;
revoke all on function private.ensure_competition_player(uuid, uuid, text, integer) from public;
revoke all on function private.ensure_competition_player(uuid, uuid, text, integer) from anon;
revoke all on function private.ensure_competition_player(uuid, uuid, text, integer) from authenticated;
revoke all on function private.replace_competition_graph(uuid, jsonb) from public;
revoke all on function private.replace_competition_graph(uuid, jsonb) from anon;
revoke all on function private.replace_competition_graph(uuid, jsonb) from authenticated;
revoke all on function private.apply_competition_score_document(uuid, uuid, integer, integer, date, jsonb) from public;
revoke all on function private.apply_competition_score_document(uuid, uuid, integer, integer, date, jsonb) from anon;
revoke all on function private.apply_competition_score_document(uuid, uuid, integer, integer, date, jsonb) from authenticated;
revoke all on function private.prepare_new_competition() from public;
revoke all on function private.prepare_new_competition() from anon;
revoke all on function private.prepare_new_competition() from authenticated;
revoke all on function private.add_competition_owner() from public;
revoke all on function private.add_competition_owner() from anon;
revoke all on function private.add_competition_owner() from authenticated;
revoke all on function private.protect_competition_audit_fields() from public;
revoke all on function private.protect_competition_audit_fields() from anon;
revoke all on function private.protect_competition_audit_fields() from authenticated;

grant execute on function private.is_competition_member(uuid) to authenticated;
grant execute on function private.shares_competition_with(uuid) to authenticated;
grant execute on function private.shares_group_with(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or private.shares_session_with(id)
    or private.shares_group_with(id)
    or private.shares_competition_with(id)
  );

grant select on table public.competitions to authenticated;
grant select on table public.competition_members to authenticated;
grant select on table public.competition_players to authenticated;
grant select on table public.competition_teams to authenticated;
grant select on table public.competition_team_members to authenticated;
grant select on table public.competition_stages to authenticated;
grant select on table public.competition_rounds to authenticated;
grant select on table public.competition_round_byes to authenticated;
grant select on table public.competition_matches to authenticated;
grant select on table public.competition_match_players to authenticated;
grant select on table public.competition_match_events to authenticated;

alter table public.competitions enable row level security;
alter table public.competition_members enable row level security;
alter table public.competition_players enable row level security;
alter table public.competition_teams enable row level security;
alter table public.competition_team_members enable row level security;
alter table public.competition_stages enable row level security;
alter table public.competition_rounds enable row level security;
alter table public.competition_round_byes enable row level security;
alter table public.competition_matches enable row level security;
alter table public.competition_match_players enable row level security;
alter table public.competition_match_events enable row level security;

alter table public.competitions force row level security;
alter table public.competition_members force row level security;
alter table public.competition_players force row level security;
alter table public.competition_teams force row level security;
alter table public.competition_team_members force row level security;
alter table public.competition_stages force row level security;
alter table public.competition_rounds force row level security;
alter table public.competition_round_byes force row level security;
alter table public.competition_matches force row level security;
alter table public.competition_match_players force row level security;
alter table public.competition_match_events force row level security;

create policy competitions_select on public.competitions
  for select to authenticated
  using (private.is_competition_member(id));

create policy competition_members_select on public.competition_members
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_players_select on public.competition_players
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_teams_select on public.competition_teams
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_team_members_select on public.competition_team_members
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_stages_select on public.competition_stages
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_rounds_select on public.competition_rounds
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_round_byes_select on public.competition_round_byes
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_matches_select on public.competition_matches
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_match_players_select on public.competition_match_players
  for select to authenticated
  using (private.is_competition_member(competition_id));

create policy competition_match_events_select on public.competition_match_events
  for select to authenticated
  using (private.is_competition_member(competition_id));

revoke all on function public.create_competition(text, date, integer, uuid, jsonb) from public;
revoke all on function public.create_competition(text, date, integer, uuid, jsonb) from anon;
revoke all on function public.join_competition_by_code(text) from public;
revoke all on function public.join_competition_by_code(text) from anon;
revoke all on function public.rotate_competition_join_code(uuid) from public;
revoke all on function public.rotate_competition_join_code(uuid) from anon;
revoke all on function public.replace_competition_teams(uuid, bigint, jsonb) from public;
revoke all on function public.replace_competition_teams(uuid, bigint, jsonb) from anon;
revoke all on function public.save_competition_structure(uuid, bigint, jsonb) from public;
revoke all on function public.save_competition_structure(uuid, bigint, jsonb) from anon;
revoke all on function public.set_competition_match_score(uuid, uuid, integer, integer, date, bigint, bigint, jsonb) from public;
revoke all on function public.set_competition_match_score(uuid, uuid, integer, integer, date, bigint, bigint, jsonb) from anon;
revoke all on function public.finalize_competition(uuid, bigint) from public;
revoke all on function public.finalize_competition(uuid, bigint) from anon;
revoke all on function public.set_competition_member_role(uuid, uuid, text) from public;
revoke all on function public.set_competition_member_role(uuid, uuid, text) from anon;
revoke all on function public.remove_competition_member(uuid, uuid) from public;
revoke all on function public.remove_competition_member(uuid, uuid) from anon;

grant execute on function public.create_competition(text, date, integer, uuid, jsonb) to authenticated;
grant execute on function public.join_competition_by_code(text) to authenticated;
grant execute on function public.rotate_competition_join_code(uuid) to authenticated;
grant execute on function public.replace_competition_teams(uuid, bigint, jsonb) to authenticated;
grant execute on function public.save_competition_structure(uuid, bigint, jsonb) to authenticated;
grant execute on function public.set_competition_match_score(uuid, uuid, integer, integer, date, bigint, bigint, jsonb) to authenticated;
grant execute on function public.finalize_competition(uuid, bigint) to authenticated;
grant execute on function public.set_competition_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_competition_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (hosted apply is still a manual checklist after review)
-- ---------------------------------------------------------------------------
do $realtime_table$
begin
  alter table public.competitions replica identity full;
  alter table public.competition_members replica identity full;
  alter table public.competition_players replica identity full;
  alter table public.competition_stages replica identity full;
  alter table public.competition_matches replica identity full;
  alter table public.competition_match_players replica identity full;
  alter table public.competition_match_events replica identity full;
  alter publication supabase_realtime add table public.competitions;
  alter publication supabase_realtime add table public.competition_members;
  alter publication supabase_realtime add table public.competition_players;
  alter publication supabase_realtime add table public.competition_stages;
  alter publication supabase_realtime add table public.competition_matches;
  alter publication supabase_realtime add table public.competition_match_players;
  alter publication supabase_realtime add table public.competition_match_events;
exception
  when duplicate_object then
    null;
  when undefined_object then
    null;
  when insufficient_privilege then
    null;
end;
$realtime_table$;
