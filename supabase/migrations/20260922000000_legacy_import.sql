-- Legacy import (etapa 7). One-way Gist/localStorage → cloud.
-- Not dual-write. Does not disable Gist. Do not apply on hosted until review.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.legacy_import_batches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_type text not null check (source_type in ('gist', 'localStorage', 'unknown')),
  source_fingerprint text,
  status text not null default 'in_progress'
    check (status in ('preview', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  unique (id, user_id)
);

create table public.legacy_import_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  batch_id uuid,
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_type text not null check (entity_type in ('player', 'session', 'competition')),
  legacy_id text not null,
  cloud_id uuid,
  status text not null check (status in ('imported', 'already_imported', 'failed')),
  error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (batch_id, user_id)
    references public.legacy_import_batches (id, user_id)
    match simple
    on delete cascade
);

-- Retry no mesmo batch atualiza o item. Batch novo gera linha histórica nova.
-- Import sem batch (batch_id null) tem escopo próprio por usuário+entidade+legado.
create unique index legacy_import_items_batch_entity_uidx
  on public.legacy_import_items (batch_id, user_id, entity_type, legacy_id)
  where batch_id is not null;

create unique index legacy_import_items_unbatched_uidx
  on public.legacy_import_items (user_id, entity_type, legacy_id)
  where batch_id is null;

create table public.legacy_player_mappings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  legacy_player_id text not null,
  cloud_player_id uuid not null references public.players (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, legacy_player_id)
);

create index legacy_import_batches_user_id_idx on public.legacy_import_batches (user_id);
create index legacy_import_items_user_id_idx on public.legacy_import_items (user_id);
create index legacy_import_items_batch_id_idx on public.legacy_import_items (batch_id);
create index legacy_player_mappings_cloud_player_id_idx on public.legacy_player_mappings (cloud_player_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.legacy_id(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_id text;
begin
  v_id := pg_catalog.btrim(coalesce(p_value, ''));
  if v_id = '' or pg_catalog.char_length(v_id) > 200 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_LEGACY_DATA';
  end if;
  return v_id;
end;
$$;

create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.btrim(p_value) = '' then
    return null;
  end if;
  if p_value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function private.import_result(
  p_status text,
  p_cloud_id uuid,
  p_legacy_id text,
  p_entity_type text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p_status,
    'cloud_id', p_cloud_id,
    'legacy_id', p_legacy_id,
    'entity_type', p_entity_type
  );
$$;

create or replace function private.map_put(p_map jsonb, p_legacy text, p_cloud uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_map, '{}'::jsonb) || jsonb_build_object(p_legacy, p_cloud::text);
$$;

create or replace function private.map_get(p_map jsonb, p_legacy text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text;
begin
  if p_legacy is null or pg_catalog.btrim(p_legacy) = '' then
    return null;
  end if;
  v_value := p_map ->> p_legacy;
  if v_value is null or v_value = '' then
    return null;
  end if;
  return v_value::uuid;
end;
$$;

create or replace function private.allocate_free_uuid(p_legacy text, p_taken uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := private.try_uuid(p_legacy);
  if v_id is not null and v_id is distinct from p_taken then
    return v_id;
  end if;
  return pg_catalog.gen_random_uuid();
end;
$$;

create or replace function private.can_map_cloud_player(p_uid uuid, p_player_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and p.archived_at is null
      and (p.created_by = p_uid or p.linked_user_id = p_uid)
  );
$$;

create or replace function private.mapped_player(p_uid uuid, p_legacy_id text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select m.cloud_player_id
  from public.legacy_player_mappings m
  where m.user_id = p_uid
    and m.legacy_player_id = p_legacy_id;
$$;

create or replace function private.require_mapped_player(p_uid uuid, p_legacy_id text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
  v_legacy text;
begin
  v_legacy := private.legacy_id(p_legacy_id);
  v_id := private.mapped_player(p_uid, v_legacy);
  if v_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'NEEDS_PLAYER_MAPPING';
  end if;
  return v_id;
end;
$$;

create or replace function private.require_active_legacy_import_batch(
  p_uid uuid,
  p_batch_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  if p_batch_id is null then
    return null;
  end if;

  select b.user_id, b.status
    into v_owner, v_status
  from public.legacy_import_batches b
  where b.id = p_batch_id;

  if v_owner is distinct from p_uid or v_status is distinct from 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_IMPORT_BATCH_INVALID';
  end if;
  return p_batch_id;
end;
$$;

create or replace function private.assert_legacy_import_owner(p_uid uuid, p_created_by uuid)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_created_by is distinct from p_uid then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_ID_CONFLICT';
  end if;
end;
$$;

create or replace function private.record_legacy_import_item(
  p_batch_id uuid,
  p_uid uuid,
  p_entity_type text,
  p_legacy_id text,
  p_cloud_id uuid,
  p_status text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_legacy_import_batch(p_uid, p_batch_id);

  if p_batch_id is null then
    insert into public.legacy_import_items (
      batch_id, user_id, entity_type, legacy_id, cloud_id, status, error_code
    )
    values (
      null, p_uid, p_entity_type, p_legacy_id, p_cloud_id, p_status, p_error_code
    )
    on conflict (user_id, entity_type, legacy_id) where batch_id is null do update
      set cloud_id = coalesce(excluded.cloud_id, public.legacy_import_items.cloud_id),
          status = excluded.status,
          error_code = excluded.error_code;
  else
    insert into public.legacy_import_items (
      batch_id, user_id, entity_type, legacy_id, cloud_id, status, error_code
    )
    values (
      p_batch_id, p_uid, p_entity_type, p_legacy_id, p_cloud_id, p_status, p_error_code
    )
    on conflict (batch_id, user_id, entity_type, legacy_id) where batch_id is not null do update
      set cloud_id = coalesce(excluded.cloud_id, public.legacy_import_items.cloud_id),
          status = excluded.status,
          error_code = excluded.error_code;
  end if;
end;
$$;

create or replace function private.remap_competition_source(
  p_source jsonb,
  p_team_map jsonb,
  p_match_map jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text;
  v_team uuid;
  v_match uuid;
  v_seed integer;
  v_out jsonb;
begin
  if p_source is null or jsonb_typeof(p_source) is distinct from 'object' then
    return '{}'::jsonb;
  end if;
  v_type := coalesce(p_source ->> 'type', '');
  v_out := jsonb_build_object('type', v_type);
  v_team := private.map_get(
    p_team_map,
    coalesce(p_source ->> 'teamId', p_source ->> 'team_id')
  );
  if v_team is not null then
    v_out := v_out || jsonb_build_object('teamId', v_team::text, 'team_id', v_team::text);
  elsif coalesce(p_source ->> 'teamId', p_source ->> 'team_id') is not null then
    v_out := v_out || jsonb_build_object(
      'teamId', p_source ->> 'teamId',
      'team_id', coalesce(p_source ->> 'team_id', p_source ->> 'teamId')
    );
  end if;
  v_match := private.map_get(
    p_match_map,
    coalesce(p_source ->> 'matchId', p_source ->> 'match_id')
  );
  if v_match is not null then
    v_out := v_out || jsonb_build_object('matchId', v_match::text, 'match_id', v_match::text);
  elsif coalesce(p_source ->> 'matchId', p_source ->> 'match_id') is not null then
    v_out := v_out || jsonb_build_object(
      'matchId', p_source ->> 'matchId',
      'match_id', coalesce(p_source ->> 'match_id', p_source ->> 'matchId')
    );
  end if;
  v_seed := nullif(coalesce(p_source ->> 'seed', ''), '')::integer;
  if v_seed is not null then
    v_out := v_out || jsonb_build_object('seed', v_seed);
  end if;
  return v_out;
end;
$$;

create or replace function private.remap_uuid_array(p_ids jsonb, p_map jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_legacy text;
  v_cloud uuid;
  v_out uuid[] := '{}';
begin
  if p_ids is null or jsonb_typeof(p_ids) is distinct from 'array' then
    return '{}';
  end if;
  for v_item in select value from jsonb_array_elements(p_ids)
  loop
    if jsonb_typeof(v_item) = 'string' then
      v_legacy := v_item #>> '{}';
    else
      v_legacy := coalesce(v_item ->> 'id', v_item ->> 'teamId', '');
    end if;
    v_cloud := private.map_get(p_map, v_legacy);
    if v_cloud is not null then
      v_out := v_out || v_cloud;
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function private.remap_seed_snapshot(p_snapshot jsonb, p_team_map jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_team uuid;
  v_legacy text;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'array' then
    return p_snapshot;
  end if;
  for v_item in select value from jsonb_array_elements(p_snapshot)
  loop
    v_legacy := coalesce(v_item ->> 'teamId', v_item ->> 'team_id');
    v_team := private.map_get(p_team_map, v_legacy);
    if v_team is not null then
      v_item := v_item || jsonb_build_object('teamId', v_team::text, 'team_id', v_team::text);
    end if;
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Batch / mapping RPCs
-- ---------------------------------------------------------------------------
create or replace function public.start_legacy_import_batch(
  p_source_type text,
  p_source_fingerprint text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_type text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_type := coalesce(nullif(pg_catalog.btrim(p_source_type), ''), 'unknown');
  if v_type not in ('gist', 'localStorage', 'unknown') then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  insert into public.legacy_import_batches (user_id, source_type, source_fingerprint, status)
  values (v_uid, v_type, nullif(pg_catalog.btrim(coalesce(p_source_fingerprint, '')), ''), 'in_progress')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_legacy_import_batch(
  p_batch_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_status not in ('completed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  update public.legacy_import_batches
  set status = p_status, finished_at = pg_catalog.now()
  where id = p_batch_id
    and user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEGACY_IMPORT_BATCH_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.list_mappable_cloud_players()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'linked_user_id', p.linked_user_id,
          'created_by', p.created_by
        )
        order by p.name, p.id
      )
      from public.players p
      where p.archived_at is null
        and (p.created_by = v_uid or p.linked_user_id = v_uid)
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.import_legacy_player(
  p_legacy_player_id text,
  p_name text,
  p_skill_score integer default null,
  p_gender text default null,
  p_height text default null,
  p_cloud_player_id uuid default null,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_legacy text;
  v_existing uuid;
  v_cloud uuid;
  v_name text;
  v_height text;
  v_taken uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  perform private.require_active_legacy_import_batch(v_uid, p_batch_id);

  v_legacy := private.legacy_id(p_legacy_player_id);
  perform pg_advisory_xact_lock(850718, hashtext(v_uid::text || ':' || v_legacy));

  v_existing := private.mapped_player(v_uid, v_legacy);
  if v_existing is not null then
    if p_cloud_player_id is not null and p_cloud_player_id is distinct from v_existing then
      raise exception using errcode = 'P0001', message = 'PLAYER_MAPPING_CONFLICT';
    end if;
    perform private.record_legacy_import_item(
      p_batch_id, v_uid, 'player', v_legacy, v_existing, 'already_imported', null
    );
    return private.import_result('already_imported', v_existing, v_legacy, 'player');
  end if;

  if p_cloud_player_id is not null then
    if not private.can_map_cloud_player(v_uid, p_cloud_player_id) then
      raise exception using errcode = 'P0001', message = 'PLAYER_MAPPING_INVALID';
    end if;
    insert into public.legacy_player_mappings (user_id, legacy_player_id, cloud_player_id)
    values (v_uid, v_legacy, p_cloud_player_id);
    perform private.record_legacy_import_item(
      p_batch_id, v_uid, 'player', v_legacy, p_cloud_player_id, 'imported', null
    );
    return private.import_result('imported', p_cloud_player_id, v_legacy, 'player');
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using errcode = 'P0001', message = 'PLAYER_NAME_REQUIRED';
  end if;
  if p_skill_score is not null and p_skill_score not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  if p_gender is not null and p_gender not in ('F', 'M') then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  v_height := coalesce(nullif(pg_catalog.btrim(coalesce(p_height, '')), ''), 'short');
  if v_height not in ('tall', 'short') then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;

  v_cloud := private.try_uuid(v_legacy);
  if v_cloud is not null then
    select p.id into v_taken from public.players p where p.id = v_cloud;
    if v_taken is not null then
      if private.can_map_cloud_player(v_uid, v_cloud) then
        insert into public.legacy_player_mappings (user_id, legacy_player_id, cloud_player_id)
        values (v_uid, v_legacy, v_cloud);
        perform private.record_legacy_import_item(
          p_batch_id, v_uid, 'player', v_legacy, v_cloud, 'imported', null
        );
        return private.import_result('imported', v_cloud, v_legacy, 'player');
      end if;
      v_cloud := pg_catalog.gen_random_uuid();
    end if;
  else
    v_cloud := pg_catalog.gen_random_uuid();
  end if;

  insert into public.players (id, name, skill_score, gender, height, created_by, linked_user_id)
  values (v_cloud, v_name, p_skill_score, p_gender, v_height, v_uid, null);

  insert into public.legacy_player_mappings (user_id, legacy_player_id, cloud_player_id)
  values (v_uid, v_legacy, v_cloud);

  perform private.record_legacy_import_item(
    p_batch_id, v_uid, 'player', v_legacy, v_cloud, 'imported', null
  );
  return private.import_result('imported', v_cloud, v_legacy, 'player');
end;
$$;

-- ---------------------------------------------------------------------------
-- Session import
-- ---------------------------------------------------------------------------
create or replace function public.import_legacy_session(
  p_legacy_id text,
  p_document jsonb,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_legacy text;
  v_existing uuid;
  v_owner uuid;
  v_session_id uuid;
  v_status text;
  v_date date;
  v_team_size integer;
  v_team_count integer;
  v_team jsonb;
  v_member jsonb;
  v_round jsonb;
  v_match jsonb;
  v_player jsonb;
  v_team_id uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_player_id uuid;
  v_name text;
  v_sort integer;
  v_side text;
  v_score_a integer;
  v_score_b integer;
  v_team_map jsonb := '{}'::jsonb;
  v_round_map jsonb := '{}'::jsonb;
  v_match_map jsonb := '{}'::jsonb;
  v_constraint text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  perform private.require_active_legacy_import_batch(v_uid, p_batch_id);
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;

  v_legacy := private.legacy_id(coalesce(p_legacy_id, p_document ->> 'id'));
  perform pg_advisory_xact_lock(850717, hashtext('session:' || v_legacy));

  select s.id, s.created_by into v_existing, v_owner
  from public.sessions s
  where s.legacy_source_id = v_legacy;

  if v_existing is not null then
    perform private.assert_legacy_import_owner(v_uid, v_owner);
    perform private.record_legacy_import_item(
      p_batch_id, v_uid, 'session', v_legacy, v_existing, 'already_imported', null
    );
    return private.import_result('already_imported', v_existing, v_legacy, 'session');
  end if;

  v_status := coalesce(p_document ->> 'status', 'draft');
  if v_status not in ('draft', 'in_progress', 'finished') then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  v_date := nullif(p_document ->> 'date', '')::date;
  if v_date is null then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  v_team_size := coalesce(
    private.json_int(p_document -> 'format', 'teamSize', 'team_size'),
    2
  );
  v_team_count := coalesce(
    private.json_int(p_document -> 'format', 'teamCount', 'team_count'),
    2
  );
  if v_team_size not between 2 and 6 or v_team_count < 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;

  v_session_id := private.try_uuid(v_legacy);
  if v_session_id is not null and exists (select 1 from public.sessions s where s.id = v_session_id) then
    v_session_id := pg_catalog.gen_random_uuid();
  end if;
  if v_session_id is null then
    v_session_id := pg_catalog.gen_random_uuid();
  end if;

  begin
    insert into public.sessions (
      id, created_by, name, date, status, team_size, team_count, court_count,
      group_id, legacy_source_id, structure_version
    )
    values (
      v_session_id,
      v_uid,
      nullif(pg_catalog.btrim(coalesce(p_document ->> 'name', '')), ''),
      v_date,
      v_status,
      v_team_size,
      v_team_count,
      private.json_int(p_document, 'courtCount', 'court_count'),
      null,
      v_legacy,
      0
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      select s.id, s.created_by into v_existing, v_owner
      from public.sessions s
      where s.legacy_source_id = v_legacy;
      if v_existing is not null then
        perform private.assert_legacy_import_owner(v_uid, v_owner);
        perform private.record_legacy_import_item(
          p_batch_id, v_uid, 'session', v_legacy, v_existing, 'already_imported', null
        );
        return private.import_result('already_imported', v_existing, v_legacy, 'session');
      end if;
      raise exception using errcode = 'P0001', message = 'CLOUD_ID_CONFLICT';
  end;

  for v_team in select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    for v_member in select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      v_player_id := private.require_mapped_player(
        v_uid,
        coalesce(v_member ->> 'playerId', v_member ->> 'player_id')
      );
      v_name := coalesce(
        nullif(pg_catalog.btrim(coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', '')), ''),
        'Jogador'
      );
      insert into public.session_players (session_id, player_id, player_name_snapshot)
      values (v_session_id, v_player_id, v_name)
      on conflict do nothing;
    end loop;
  end loop;

  for v_round in select value from jsonb_array_elements(coalesce(p_document -> 'rounds', '[]'::jsonb))
  loop
    for v_match in select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
    loop
      foreach v_side in array array['A', 'B']
      loop
        for v_player in
          select value
          from jsonb_array_elements(
            coalesce(v_match -> ('lineup' || v_side), v_match -> ('lineup_' || lower(v_side)), '[]'::jsonb)
          )
        loop
          v_player_id := private.require_mapped_player(
            v_uid,
            coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
          );
          v_name := coalesce(
            nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
            'Jogador'
          );
          insert into public.session_players (session_id, player_id, player_name_snapshot)
          values (v_session_id, v_player_id, v_name)
          on conflict do nothing;
        end loop;
      end loop;
    end loop;
  end loop;

  v_sort := 0;
  for v_team in select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    v_team_id := private.try_uuid(coalesce(v_team ->> 'id', ''));
    if v_team_id is null or exists (select 1 from public.teams t where t.id = v_team_id) then
      v_team_id := pg_catalog.gen_random_uuid();
    end if;
    v_team_map := private.map_put(v_team_map, coalesce(v_team ->> 'id', ''), v_team_id);
    insert into public.teams (id, session_id, name, sort_index)
    values (
      v_team_id,
      v_session_id,
      nullif(pg_catalog.btrim(coalesce(v_team ->> 'name', '')), ''),
      v_sort
    );
    for v_member in select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      v_player_id := private.require_mapped_player(
        v_uid,
        coalesce(v_member ->> 'playerId', v_member ->> 'player_id')
      );
      v_name := coalesce(
        nullif(pg_catalog.btrim(coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', '')), ''),
        'Jogador'
      );
      insert into public.team_members (team_id, session_id, player_id, player_name_snapshot)
      values (v_team_id, v_session_id, v_player_id, v_name);
    end loop;
    v_sort := v_sort + 1;
  end loop;

  for v_round in select value from jsonb_array_elements(coalesce(p_document -> 'rounds', '[]'::jsonb))
  loop
    v_round_id := private.try_uuid(coalesce(v_round ->> 'id', ''));
    if v_round_id is null or exists (select 1 from public.rounds r where r.id = v_round_id) then
      v_round_id := pg_catalog.gen_random_uuid();
    end if;
    v_round_map := private.map_put(v_round_map, coalesce(v_round ->> 'id', ''), v_round_id);
    insert into public.rounds (id, session_id, number, cycle_number, bye_team_id)
    values (
      v_round_id,
      v_session_id,
      coalesce((v_round ->> 'number')::integer, 1),
      coalesce((v_round ->> 'cycleNumber')::integer, (v_round ->> 'cycle_number')::integer, 1),
      private.map_get(v_team_map, coalesce(v_round ->> 'byeTeamId', v_round ->> 'bye_team_id'))
    );

    for v_match in select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
    loop
      v_match_id := private.try_uuid(coalesce(v_match ->> 'id', ''));
      if v_match_id is null or exists (select 1 from public.matches m where m.id = v_match_id) then
        v_match_id := pg_catalog.gen_random_uuid();
      end if;
      v_match_map := private.map_put(v_match_map, coalesce(v_match ->> 'id', ''), v_match_id);
      v_score_a := nullif(coalesce(v_match ->> 'scoreA', v_match ->> 'score_a'), '')::integer;
      v_score_b := nullif(coalesce(v_match ->> 'scoreB', v_match ->> 'score_b'), '')::integer;
      insert into public.matches (
        id, session_id, round_id, team_a_id, team_b_id, score_a, score_b, version, updated_by
      )
      values (
        v_match_id,
        v_session_id,
        v_round_id,
        private.map_get(v_team_map, coalesce(v_match ->> 'teamAId', v_match ->> 'team_a_id')),
        private.map_get(v_team_map, coalesce(v_match ->> 'teamBId', v_match ->> 'team_b_id')),
        v_score_a,
        v_score_b,
        0,
        null
      );

      v_sort := 0;
      for v_player in
        select value from jsonb_array_elements(coalesce(v_match -> 'lineupA', v_match -> 'lineup_a', '[]'::jsonb))
      loop
        v_player_id := private.require_mapped_player(
          v_uid,
          coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
        );
        v_name := coalesce(
          nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
          'Jogador'
        );
        insert into public.match_players (
          match_id, session_id, player_id, side, sort_index, player_name_snapshot
        )
        values (v_match_id, v_session_id, v_player_id, 'a', v_sort, v_name);
        v_sort := v_sort + 1;
      end loop;

      v_sort := 0;
      for v_player in
        select value from jsonb_array_elements(coalesce(v_match -> 'lineupB', v_match -> 'lineup_b', '[]'::jsonb))
      loop
        v_player_id := private.require_mapped_player(
          v_uid,
          coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
        );
        v_name := coalesce(
          nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
          'Jogador'
        );
        insert into public.match_players (
          match_id, session_id, player_id, side, sort_index, player_name_snapshot
        )
        values (v_match_id, v_session_id, v_player_id, 'b', v_sort, v_name);
        v_sort := v_sort + 1;
      end loop;
    end loop;
  end loop;

  perform private.record_legacy_import_item(
    p_batch_id, v_uid, 'session', v_legacy, v_session_id, 'imported', null
  );
  return private.import_result('imported', v_session_id, v_legacy, 'session');
end;
$$;

-- ---------------------------------------------------------------------------
-- Competition import
-- ---------------------------------------------------------------------------
create or replace function public.import_legacy_competition(
  p_legacy_id text,
  p_document jsonb,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_legacy text;
  v_existing uuid;
  v_owner uuid;
  v_comp_id uuid;
  v_status text;
  v_date date;
  v_team_size integer;
  v_team jsonb;
  v_member jsonb;
  v_stage jsonb;
  v_round jsonb;
  v_match jsonb;
  v_bye jsonb;
  v_player jsonb;
  v_team_id uuid;
  v_stage_id uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_player_id uuid;
  v_name text;
  v_sort integer;
  v_player_sort integer := 0;
  v_score_a integer;
  v_score_b integer;
  v_team_map jsonb := '{}'::jsonb;
  v_stage_map jsonb := '{}'::jsonb;
  v_round_map jsonb := '{}'::jsonb;
  v_match_map jsonb := '{}'::jsonb;
  v_constraint text;
  v_type text;
  v_stage_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  perform private.require_active_legacy_import_batch(v_uid, p_batch_id);
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;

  v_legacy := private.legacy_id(coalesce(p_legacy_id, p_document ->> 'id'));
  perform pg_advisory_xact_lock(850719, hashtext('competition:' || v_legacy));

  select c.id, c.created_by into v_existing, v_owner
  from public.competitions c
  where c.legacy_source_id = v_legacy;

  if v_existing is not null then
    perform private.assert_legacy_import_owner(v_uid, v_owner);
    perform private.record_legacy_import_item(
      p_batch_id, v_uid, 'competition', v_legacy, v_existing, 'already_imported', null
    );
    return private.import_result('already_imported', v_existing, v_legacy, 'competition');
  end if;

  v_status := coalesce(p_document ->> 'status', 'draft');
  if v_status not in ('draft', 'in_progress', 'finished') then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  v_date := nullif(p_document ->> 'date', '')::date;
  if v_date is null then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;
  v_team_size := coalesce(private.json_int(p_document -> 'format', 'teamSize', 'team_size'), 2);
  if v_team_size not between 2 and 6 then
    raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
  end if;

  v_comp_id := private.try_uuid(v_legacy);
  if v_comp_id is not null and exists (select 1 from public.competitions c where c.id = v_comp_id) then
    v_comp_id := pg_catalog.gen_random_uuid();
  end if;
  if v_comp_id is null then
    v_comp_id := pg_catalog.gen_random_uuid();
  end if;

  -- Allocate IDs first so sources can remap match/team references.
  v_sort := 0;
  for v_team in select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    v_team_id := private.try_uuid(coalesce(v_team ->> 'id', ''));
    if v_team_id is null or exists (select 1 from public.competition_teams t where t.id = v_team_id) then
      v_team_id := pg_catalog.gen_random_uuid();
    end if;
    v_team_map := private.map_put(v_team_map, coalesce(v_team ->> 'id', ''), v_team_id);
    v_sort := v_sort + 1;
  end loop;

  for v_stage in select value from jsonb_array_elements(coalesce(p_document -> 'stages', '[]'::jsonb))
  loop
    v_stage_id := private.try_uuid(coalesce(v_stage ->> 'id', ''));
    if v_stage_id is null or exists (select 1 from public.competition_stages s where s.id = v_stage_id) then
      v_stage_id := pg_catalog.gen_random_uuid();
    end if;
    v_stage_map := private.map_put(v_stage_map, coalesce(v_stage ->> 'id', ''), v_stage_id);
    for v_round in select value from jsonb_array_elements(coalesce(v_stage -> 'rounds', '[]'::jsonb))
    loop
      v_round_id := private.try_uuid(coalesce(v_round ->> 'id', ''));
      if v_round_id is null or exists (select 1 from public.competition_rounds r where r.id = v_round_id) then
        v_round_id := pg_catalog.gen_random_uuid();
      end if;
      v_round_map := private.map_put(v_round_map, coalesce(v_round ->> 'id', ''), v_round_id);
      for v_match in select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
      loop
        v_match_id := private.try_uuid(coalesce(v_match ->> 'id', ''));
        if v_match_id is null or exists (select 1 from public.competition_matches m where m.id = v_match_id) then
          v_match_id := pg_catalog.gen_random_uuid();
        end if;
        v_match_map := private.map_put(v_match_map, coalesce(v_match ->> 'id', ''), v_match_id);
      end loop;
    end loop;
  end loop;

  begin
    insert into public.competitions (
      id, group_id, created_by, name, date, status, format_team_size,
      legacy_source_id, structure_version, seed_team_ids
    )
    values (
      v_comp_id,
      null,
      v_uid,
      nullif(pg_catalog.btrim(coalesce(p_document ->> 'name', '')), ''),
      v_date,
      v_status,
      v_team_size,
      v_legacy,
      0,
      private.remap_uuid_array(
        coalesce(p_document -> 'seedTeamIds', p_document -> 'seed_team_ids', '[]'::jsonb),
        v_team_map
      )
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      select c.id, c.created_by into v_existing, v_owner
      from public.competitions c
      where c.legacy_source_id = v_legacy;
      if v_existing is not null then
        perform private.assert_legacy_import_owner(v_uid, v_owner);
        perform private.record_legacy_import_item(
          p_batch_id, v_uid, 'competition', v_legacy, v_existing, 'already_imported', null
        );
        return private.import_result('already_imported', v_existing, v_legacy, 'competition');
      end if;
      raise exception using errcode = 'P0001', message = 'CLOUD_ID_CONFLICT';
  end;

  for v_team in select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    for v_member in select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      v_player_id := private.require_mapped_player(
        v_uid,
        coalesce(v_member ->> 'playerId', v_member ->> 'player_id')
      );
      v_name := coalesce(
        nullif(pg_catalog.btrim(coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', '')), ''),
        'Jogador'
      );
      insert into public.competition_players (competition_id, player_id, player_name_snapshot, sort_index)
      values (v_comp_id, v_player_id, v_name, v_player_sort)
      on conflict do nothing;
      v_player_sort := v_player_sort + 1;
    end loop;
  end loop;

  for v_stage in select value from jsonb_array_elements(coalesce(p_document -> 'stages', '[]'::jsonb))
  loop
    for v_round in select value from jsonb_array_elements(coalesce(v_stage -> 'rounds', '[]'::jsonb))
    loop
      for v_match in select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
      loop
        for v_player in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupA', v_match -> 'lineup_a', '[]'::jsonb))
        loop
          v_player_id := private.require_mapped_player(
            v_uid,
            coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
          );
          v_name := coalesce(
            nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
            'Jogador'
          );
          insert into public.competition_players (competition_id, player_id, player_name_snapshot, sort_index)
          values (v_comp_id, v_player_id, v_name, v_player_sort)
          on conflict do nothing;
          v_player_sort := v_player_sort + 1;
        end loop;
        for v_player in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupB', v_match -> 'lineup_b', '[]'::jsonb))
        loop
          v_player_id := private.require_mapped_player(
            v_uid,
            coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
          );
          v_name := coalesce(
            nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
            'Jogador'
          );
          insert into public.competition_players (competition_id, player_id, player_name_snapshot, sort_index)
          values (v_comp_id, v_player_id, v_name, v_player_sort)
          on conflict do nothing;
          v_player_sort := v_player_sort + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  v_sort := 0;
  for v_team in select value from jsonb_array_elements(coalesce(p_document -> 'teams', '[]'::jsonb))
  loop
    v_team_id := private.map_get(v_team_map, coalesce(v_team ->> 'id', ''));
    insert into public.competition_teams (id, competition_id, sort_index)
    values (v_team_id, v_comp_id, v_sort);
    v_player_sort := 0;
    for v_member in select value from jsonb_array_elements(coalesce(v_team -> 'members', '[]'::jsonb))
    loop
      v_player_id := private.require_mapped_player(
        v_uid,
        coalesce(v_member ->> 'playerId', v_member ->> 'player_id')
      );
      v_name := coalesce(
        nullif(pg_catalog.btrim(coalesce(v_member ->> 'playerName', v_member ->> 'player_name_snapshot', '')), ''),
        'Jogador'
      );
      insert into public.competition_team_members (
        team_id, competition_id, player_id, player_name_snapshot, sort_index
      )
      values (v_team_id, v_comp_id, v_player_id, v_name, v_player_sort);
      v_player_sort := v_player_sort + 1;
    end loop;
    v_sort := v_sort + 1;
  end loop;

  for v_stage in select value from jsonb_array_elements(coalesce(p_document -> 'stages', '[]'::jsonb))
  loop
    v_stage_id := private.map_get(v_stage_map, coalesce(v_stage ->> 'id', ''));
    v_type := coalesce(v_stage ->> 'type', 'single_elimination');
    if v_type not in ('swiss', 'double_elimination', 'single_elimination', 'round_robin', 'groups') then
      raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
    end if;
    v_stage_status := coalesce(v_stage ->> 'status', 'pending');
    if v_stage_status not in ('pending', 'in_progress', 'finished') then
      raise exception using errcode = 'P0001', message = 'INVALID_LEGACY_DATA';
    end if;
    insert into public.competition_stages (
      id, competition_id, number, name, type, status, config, seed_team_ids, seed_snapshot
    )
    values (
      v_stage_id,
      v_comp_id,
      coalesce((v_stage ->> 'number')::integer, 1),
      nullif(pg_catalog.btrim(coalesce(v_stage ->> 'name', '')), ''),
      v_type,
      v_stage_status,
      coalesce(v_stage -> 'config', '{}'::jsonb),
      private.remap_uuid_array(
        coalesce(v_stage -> 'seedTeamIds', v_stage -> 'seed_team_ids', '[]'::jsonb),
        v_team_map
      ),
      private.remap_seed_snapshot(v_stage -> 'seedSnapshot', v_team_map)
    );

    for v_round in select value from jsonb_array_elements(coalesce(v_stage -> 'rounds', '[]'::jsonb))
    loop
      v_round_id := private.map_get(v_round_map, coalesce(v_round ->> 'id', ''));
      insert into public.competition_rounds (
        id, competition_id, stage_id, number, name, bracket
      )
      values (
        v_round_id,
        v_comp_id,
        v_stage_id,
        coalesce((v_round ->> 'number')::integer, 1),
        nullif(pg_catalog.btrim(coalesce(v_round ->> 'name', '')), ''),
        nullif(v_round ->> 'bracket', '')
      );

      for v_bye in select value from jsonb_array_elements(coalesce(v_round -> 'byes', '[]'::jsonb))
      loop
        insert into public.competition_round_byes (round_id, competition_id, team_id)
        values (
          v_round_id,
          v_comp_id,
          private.map_get(v_team_map, coalesce(v_bye ->> 'teamId', v_bye ->> 'team_id'))
        );
      end loop;

      for v_match in select value from jsonb_array_elements(coalesce(v_round -> 'matches', '[]'::jsonb))
      loop
        v_match_id := private.map_get(v_match_map, coalesce(v_match ->> 'id', ''));
        v_score_a := nullif(coalesce(v_match ->> 'scoreA', v_match ->> 'score_a'), '')::integer;
        v_score_b := nullif(coalesce(v_match ->> 'scoreB', v_match ->> 'score_b'), '')::integer;
        insert into public.competition_matches (
          id, competition_id, stage_id, round_id,
          source_a, source_b, team_a_id, team_b_id,
          score_a, score_b, played_date, winner_team_id, version, updated_by
        )
        values (
          v_match_id,
          v_comp_id,
          v_stage_id,
          v_round_id,
          private.remap_competition_source(
            coalesce(v_match -> 'sourceA', v_match -> 'source_a'),
            v_team_map,
            v_match_map
          ),
          private.remap_competition_source(
            coalesce(v_match -> 'sourceB', v_match -> 'source_b'),
            v_team_map,
            v_match_map
          ),
          private.map_get(v_team_map, coalesce(v_match ->> 'teamAId', v_match ->> 'team_a_id')),
          private.map_get(v_team_map, coalesce(v_match ->> 'teamBId', v_match ->> 'team_b_id')),
          v_score_a,
          v_score_b,
          nullif(coalesce(v_match ->> 'playedDate', v_match ->> 'played_date'), '')::date,
          private.map_get(v_team_map, coalesce(v_match ->> 'winnerTeamId', v_match ->> 'winner_team_id')),
          0,
          null
        );

        v_sort := 0;
        for v_player in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupA', v_match -> 'lineup_a', '[]'::jsonb))
        loop
          v_player_id := private.require_mapped_player(
            v_uid,
            coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
          );
          v_name := coalesce(
            nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
            'Jogador'
          );
          insert into public.competition_match_players (
            match_id, competition_id, player_id, side, sort_index, player_name_snapshot
          )
          values (v_match_id, v_comp_id, v_player_id, 'a', v_sort, v_name);
          v_sort := v_sort + 1;
        end loop;

        v_sort := 0;
        for v_player in
          select value from jsonb_array_elements(coalesce(v_match -> 'lineupB', v_match -> 'lineup_b', '[]'::jsonb))
        loop
          v_player_id := private.require_mapped_player(
            v_uid,
            coalesce(v_player ->> 'playerId', v_player ->> 'player_id')
          );
          v_name := coalesce(
            nullif(pg_catalog.btrim(coalesce(v_player ->> 'playerName', v_player ->> 'player_name_snapshot', '')), ''),
            'Jogador'
          );
          insert into public.competition_match_players (
            match_id, competition_id, player_id, side, sort_index, player_name_snapshot
          )
          values (v_match_id, v_comp_id, v_player_id, 'b', v_sort, v_name);
          v_sort := v_sort + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  perform private.record_legacy_import_item(
    p_batch_id, v_uid, 'competition', v_legacy, v_comp_id, 'imported', null
  );
  return private.import_result('imported', v_comp_id, v_legacy, 'competition');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants / RLS
-- ---------------------------------------------------------------------------
revoke all on function private.legacy_id(text) from public, anon, authenticated;
revoke all on function private.try_uuid(text) from public, anon, authenticated;
revoke all on function private.import_result(text, uuid, text, text) from public, anon, authenticated;
revoke all on function private.map_put(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function private.map_get(jsonb, text) from public, anon, authenticated;
revoke all on function private.allocate_free_uuid(text, uuid) from public, anon, authenticated;
revoke all on function private.can_map_cloud_player(uuid, uuid) from public, anon, authenticated;
revoke all on function private.mapped_player(uuid, text) from public, anon, authenticated;
revoke all on function private.require_mapped_player(uuid, text) from public, anon, authenticated;
revoke all on function private.require_active_legacy_import_batch(uuid, uuid) from public, anon, authenticated;
revoke all on function private.assert_legacy_import_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function private.record_legacy_import_item(uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function private.remap_competition_source(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.remap_uuid_array(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.remap_seed_snapshot(jsonb, jsonb) from public, anon, authenticated;

revoke all on function public.start_legacy_import_batch(text, text) from public, anon;
revoke all on function public.finish_legacy_import_batch(uuid, text) from public, anon;
revoke all on function public.list_mappable_cloud_players() from public, anon;
revoke all on function public.import_legacy_player(text, text, integer, text, text, uuid, uuid) from public, anon;
revoke all on function public.import_legacy_session(text, jsonb, uuid) from public, anon;
revoke all on function public.import_legacy_competition(text, jsonb, uuid) from public, anon;

grant execute on function public.start_legacy_import_batch(text, text) to authenticated;
grant execute on function public.finish_legacy_import_batch(uuid, text) to authenticated;
grant execute on function public.list_mappable_cloud_players() to authenticated;
grant execute on function public.import_legacy_player(text, text, integer, text, text, uuid, uuid) to authenticated;
grant execute on function public.import_legacy_session(text, jsonb, uuid) to authenticated;
grant execute on function public.import_legacy_competition(text, jsonb, uuid) to authenticated;

grant select on table public.legacy_import_batches to authenticated;
grant select on table public.legacy_import_items to authenticated;
grant select on table public.legacy_player_mappings to authenticated;

alter table public.legacy_import_batches enable row level security;
alter table public.legacy_import_items enable row level security;
alter table public.legacy_player_mappings enable row level security;
alter table public.legacy_import_batches force row level security;
alter table public.legacy_import_items force row level security;
alter table public.legacy_player_mappings force row level security;

create policy legacy_import_batches_select on public.legacy_import_batches
  for select to authenticated
  using (user_id = auth.uid());

create policy legacy_import_items_select on public.legacy_import_items
  for select to authenticated
  using (user_id = auth.uid());

create policy legacy_player_mappings_select on public.legacy_player_mappings
  for select to authenticated
  using (user_id = auth.uid());
