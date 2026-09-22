-- Etapa 11: disponibilidade de horários + propostas de jogo + RSVP.
-- Additive. Do not edit previous migrations. Do not db push from the app repo.
--
-- friends != group_members != group_availability != game_proposals
--   != proposal_responses != session_members != session_players
--   != competition_members != competition_players
-- availability != game_proposal != session
-- Marcar disponibilidade não cria proposal. Criar proposal não cria session.
-- RSVP "Vou" não cria session_member nem session_player.

-- ---------------------------------------------------------------------------
-- Group timezone
-- ---------------------------------------------------------------------------
alter table public.groups
  add column if not exists timezone text not null default 'America/Sao_Paulo';

create or replace function private.is_supported_timezone(p_tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_tz is null or pg_catalog.btrim(p_tz) = '' then
    return false;
  end if;

  begin
    return exists (
      select 1
      from pg_catalog.pg_timezone_names n
      where n.name = p_tz
    );
  exception
    when undefined_table then
      begin
        perform (timestamp '2000-01-01 00:00:00' at time zone p_tz);
        return true;
      exception
        when others then
          return false;
      end;
  end;
end;
$$;

revoke all on function private.is_supported_timezone(text) from public;
revoke all on function private.is_supported_timezone(text) from anon;
revoke all on function private.is_supported_timezone(text) from authenticated;

create or replace function private.protect_group_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.timezone := pg_catalog.btrim(coalesce(new.timezone, 'America/Sao_Paulo'));
  if not private.is_supported_timezone(new.timezone) then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_TIMEZONE_INVALID';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_group_timezone() from public;
revoke all on function private.protect_group_timezone() from anon;
revoke all on function private.protect_group_timezone() from authenticated;

drop trigger if exists groups_protect_timezone on public.groups;
create trigger groups_protect_timezone
  before insert or update of timezone on public.groups
  for each row
  execute function private.protect_group_timezone();

create or replace function public.update_group_timezone(p_group_id uuid, p_timezone text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if not private.can_manage_group(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_FORBIDDEN';
  end if;

  update public.groups
  set timezone = p_timezone
  where id = p_group_id
  returning * into v_group;

  if v_group.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_NOT_FOUND';
  end if;

  return v_group;
end;
$$;

revoke all on function public.update_group_timezone(uuid, text) from public;
revoke all on function public.update_group_timezone(uuid, text) from anon;
grant execute on function public.update_group_timezone(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------
create table public.group_availability_slots (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot_start timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (group_id, user_id, slot_start),
  constraint group_availability_slots_seconds check (
    slot_start = pg_catalog.date_trunc('second', slot_start)
  )
);

create index group_availability_slots_group_start_idx
  on public.group_availability_slots (group_id, slot_start);

drop trigger if exists group_availability_slots_set_updated_at on public.group_availability_slots;
create trigger group_availability_slots_set_updated_at
  before update on public.group_availability_slots
  for each row
  execute function private.set_updated_at();

alter table public.group_availability_slots enable row level security;
alter table public.group_availability_slots force row level security;

create policy group_availability_slots_select_member on public.group_availability_slots
  for select to authenticated
  using (private.is_group_member(group_id));

revoke all on table public.group_availability_slots from public;
revoke all on table public.group_availability_slots from anon;
revoke insert, update, delete on table public.group_availability_slots from authenticated;
grant select on table public.group_availability_slots to authenticated;

drop function if exists private.assert_availability_slot(timestamptz);

create or replace function private.assert_availability_slot(p_group_id uuid, p_slot timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_local timestamp;
begin
  if p_group_id is null or p_slot is null
     or p_slot is distinct from pg_catalog.date_trunc('second', p_slot)
  then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_SLOT_INVALID';
  end if;

  select g.timezone into v_tz from public.groups g where g.id = p_group_id;
  if v_tz is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_NOT_FOUND';
  end if;

  v_local := p_slot at time zone v_tz;
  if v_local is distinct from pg_catalog.date_trunc('minute', v_local)
     or extract(minute from v_local)::integer not in (0, 30)
  then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_SLOT_INVALID';
  end if;

  if p_slot < pg_catalog.now() - interval '30 minutes' then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_SLOT_INVALID';
  end if;

  if p_slot > pg_catalog.now() + interval '90 days' then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_SLOT_INVALID';
  end if;
end;
$$;

revoke all on function private.assert_availability_slot(uuid, timestamptz) from public;
revoke all on function private.assert_availability_slot(uuid, timestamptz) from anon;
revoke all on function private.assert_availability_slot(uuid, timestamptz) from authenticated;

create or replace function private.protect_availability_slot_alignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_availability_slot(new.group_id, new.slot_start);
  return new;
end;
$$;

revoke all on function private.protect_availability_slot_alignment() from public;
revoke all on function private.protect_availability_slot_alignment() from anon;
revoke all on function private.protect_availability_slot_alignment() from authenticated;

drop trigger if exists group_availability_slots_protect_alignment on public.group_availability_slots;
create trigger group_availability_slots_protect_alignment
  before insert or update of group_id, slot_start on public.group_availability_slots
  for each row
  execute function private.protect_availability_slot_alignment();

create or replace function public.set_my_group_availability(
  p_group_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_slot_starts timestamptz[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slots timestamptz[];
  v_slot timestamptz;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  if p_window_start is null
     or p_window_end is null
     or p_window_end <= p_window_start
     or p_window_end - p_window_start > interval '31 days'
  then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_RANGE_INVALID';
  end if;

  v_slots := coalesce(p_slot_starts, array[]::timestamptz[]);
  if pg_catalog.array_length(v_slots, 1) > 1000 then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_RANGE_INVALID';
  end if;

  foreach v_slot in array v_slots loop
    perform private.assert_availability_slot(p_group_id, v_slot);
    if v_slot < p_window_start or v_slot >= p_window_end then
      raise exception using
        errcode = 'P0001',
        message = 'AVAILABILITY_SLOT_INVALID';
    end if;
  end loop;

  delete from public.group_availability_slots
  where group_id = p_group_id
    and user_id = v_uid
    and slot_start >= p_window_start
    and slot_start < p_window_end;

  insert into public.group_availability_slots (group_id, user_id, slot_start)
  select p_group_id, v_uid, d.slot_start
  from (
    select distinct unnest(v_slots) as slot_start
  ) d;

  return jsonb_build_object(
    'group_id', p_group_id,
    'user_id', v_uid,
    'saved', coalesce(pg_catalog.array_length(v_slots, 1), 0)
  );
end;
$$;

create or replace function public.get_group_availability(
  p_group_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if p_start is null
     or p_end is null
     or p_end <= p_start
     or p_end - p_start > interval '31 days'
  then
    raise exception using
      errcode = 'P0001',
      message = 'AVAILABILITY_RANGE_INVALID';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if v_group.id is null then
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
    'group_id', v_group.id,
    'timezone', v_group.timezone,
    'members',
    coalesce(
      (
        select jsonb_agg(member_row order by display_name, username)
        from (
          select
            jsonb_build_object(
              'user_id', pr.id,
              'username', pr.username,
              'display_name', coalesce(pr.display_name, ''),
              'avatar_path', pr.avatar_path
            ) as member_row,
            coalesce(pr.display_name, '') as display_name,
            pr.username
          from public.group_members gm
          join public.profiles pr on pr.id = gm.user_id
          where gm.group_id = p_group_id
        ) members
      ),
      '[]'::jsonb
    ),
    'slots',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'user_id', s.user_id,
          'slot_start', s.slot_start
        ) order by s.slot_start, s.user_id)
        from public.group_availability_slots s
        join public.group_members gm
          on gm.group_id = s.group_id
         and gm.user_id = s.user_id
        where s.group_id = p_group_id
          and s.slot_start >= p_start
          and s.slot_start < p_end
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.set_my_group_availability(uuid, timestamptz, timestamptz, timestamptz[]) from public;
revoke all on function public.set_my_group_availability(uuid, timestamptz, timestamptz, timestamptz[]) from anon;
grant execute on function public.set_my_group_availability(uuid, timestamptz, timestamptz, timestamptz[]) to authenticated;

revoke all on function public.get_group_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function public.get_group_availability(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.get_group_availability(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Game proposals
-- ---------------------------------------------------------------------------
create table public.group_game_proposals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_name text,
  location_details text,
  notes text,
  status text not null default 'open'
    check (status in ('open', 'confirmed', 'cancelled')),
  linked_session_id uuid unique references public.sessions (id) on delete set null,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  constraint group_game_proposals_title_len check (char_length(btrim(title)) between 1 and 80),
  constraint group_game_proposals_time check (ends_at > starts_at),
  constraint group_game_proposals_duration check (
    ends_at - starts_at >= interval '30 minutes'
    and ends_at - starts_at <= interval '8 hours'
  ),
  constraint group_game_proposals_location_name_len check (
    location_name is null or char_length(location_name) <= 120
  ),
  constraint group_game_proposals_location_details_len check (
    location_details is null or char_length(location_details) <= 500
  ),
  constraint group_game_proposals_notes_len check (
    notes is null or char_length(notes) <= 500
  )
);

create index group_game_proposals_group_starts_idx
  on public.group_game_proposals (group_id, starts_at);

drop trigger if exists group_game_proposals_set_updated_at on public.group_game_proposals;
create trigger group_game_proposals_set_updated_at
  before update on public.group_game_proposals
  for each row
  execute function private.set_updated_at();

alter table public.group_game_proposals enable row level security;
alter table public.group_game_proposals force row level security;

create policy group_game_proposals_select_member on public.group_game_proposals
  for select to authenticated
  using (private.is_group_member(group_id));

revoke all on table public.group_game_proposals from public;
revoke all on table public.group_game_proposals from anon;
revoke insert, update, delete on table public.group_game_proposals from authenticated;
grant select on table public.group_game_proposals to authenticated;

create table public.group_game_proposal_responses (
  proposal_id uuid not null references public.group_game_proposals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  response text not null check (response in ('yes', 'maybe', 'no')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (proposal_id, user_id)
);

drop trigger if exists group_game_proposal_responses_set_updated_at on public.group_game_proposal_responses;
create trigger group_game_proposal_responses_set_updated_at
  before update on public.group_game_proposal_responses
  for each row
  execute function private.set_updated_at();

alter table public.group_game_proposal_responses enable row level security;
alter table public.group_game_proposal_responses force row level security;

create policy group_game_proposal_responses_select_member on public.group_game_proposal_responses
  for select to authenticated
  using (
    exists (
      select 1
      from public.group_game_proposals p
      where p.id = proposal_id
        and private.is_group_member(p.group_id)
    )
  );

revoke all on table public.group_game_proposal_responses from public;
revoke all on table public.group_game_proposal_responses from anon;
revoke insert, update, delete on table public.group_game_proposal_responses from authenticated;
grant select on table public.group_game_proposal_responses to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $realtime$
begin
  alter table public.group_availability_slots replica identity full;
  alter table public.group_game_proposals replica identity full;
  alter table public.group_game_proposal_responses replica identity full;
  alter publication supabase_realtime add table public.group_availability_slots;
  alter publication supabase_realtime add table public.group_game_proposals;
  alter publication supabase_realtime add table public.group_game_proposal_responses;
exception
  when duplicate_object then
    null;
  when undefined_object then
    null;
  when insufficient_privilege then
    null;
end;
$realtime$;

-- ---------------------------------------------------------------------------
-- Proposal helpers / RPCs
-- ---------------------------------------------------------------------------
create or replace function private.can_manage_group_proposal(p_proposal public.group_game_proposals)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_proposal.created_by = auth.uid()
      or private.can_manage_group(p_proposal.group_id);
$$;

revoke all on function private.can_manage_group_proposal(public.group_game_proposals) from public;
revoke all on function private.can_manage_group_proposal(public.group_game_proposals) from anon;
revoke all on function private.can_manage_group_proposal(public.group_game_proposals) from authenticated;

create or replace function private.lock_group_proposal(p_proposal_id uuid, p_expected_version bigint)
returns public.group_game_proposals
language plpgsql
set search_path = ''
as $$
declare
  v_row public.group_game_proposals;
begin
  select * into v_row
  from public.group_game_proposals
  where id = p_proposal_id
  for update;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PROPOSAL_NOT_FOUND';
  end if;

  if p_expected_version is not null and v_row.version is distinct from p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_VERSION_CONFLICT';
  end if;

  return v_row;
end;
$$;

revoke all on function private.lock_group_proposal(uuid, bigint) from public;
revoke all on function private.lock_group_proposal(uuid, bigint) from anon;
revoke all on function private.lock_group_proposal(uuid, bigint) from authenticated;

create or replace function private.proposal_json(p_proposal public.group_game_proposals)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_members integer;
begin
  select count(*)::integer into v_members
  from public.group_members gm
  where gm.group_id = p_proposal.group_id;

  return jsonb_build_object(
    'id', p_proposal.id,
    'group_id', p_proposal.group_id,
    'created_by', p_proposal.created_by,
    'title', p_proposal.title,
    'starts_at', p_proposal.starts_at,
    'ends_at', p_proposal.ends_at,
    'location_name', p_proposal.location_name,
    'location_details', p_proposal.location_details,
    'notes', p_proposal.notes,
    'status', p_proposal.status,
    'linked_session_id', p_proposal.linked_session_id,
    'version', p_proposal.version,
    'created_at', p_proposal.created_at,
    'updated_at', p_proposal.updated_at,
    'confirmed_at', p_proposal.confirmed_at,
    'cancelled_at', p_proposal.cancelled_at,
    'creator', (
      select jsonb_build_object(
        'user_id', pr.id,
        'username', pr.username,
        'display_name', coalesce(pr.display_name, ''),
        'avatar_path', pr.avatar_path
      )
      from public.profiles pr
      where pr.id = p_proposal.created_by
    ),
    'counts', jsonb_build_object(
      'yes', (
        select count(*)::integer
        from public.group_game_proposal_responses r
        join public.group_members gm
          on gm.group_id = p_proposal.group_id
         and gm.user_id = r.user_id
        where r.proposal_id = p_proposal.id and r.response = 'yes'
      ),
      'maybe', (
        select count(*)::integer
        from public.group_game_proposal_responses r
        join public.group_members gm
          on gm.group_id = p_proposal.group_id
         and gm.user_id = r.user_id
        where r.proposal_id = p_proposal.id and r.response = 'maybe'
      ),
      'no', (
        select count(*)::integer
        from public.group_game_proposal_responses r
        join public.group_members gm
          on gm.group_id = p_proposal.group_id
         and gm.user_id = r.user_id
        where r.proposal_id = p_proposal.id and r.response = 'no'
      ),
      'unanswered', v_members - (
        select count(*)::integer
        from public.group_game_proposal_responses r
        join public.group_members gm
          on gm.group_id = p_proposal.group_id
         and gm.user_id = r.user_id
        where r.proposal_id = p_proposal.id
      )
    ),
    'responses',
    coalesce(
      (
        select jsonb_agg(resp order by display_name, username)
        from (
          select
            jsonb_build_object(
              'user_id', pr.id,
              'username', pr.username,
              'display_name', coalesce(pr.display_name, ''),
              'avatar_path', pr.avatar_path,
              'player_id', pl.id,
              'player_name', pl.name,
              'response', r.response,
              'updated_at', r.updated_at
            ) as resp,
            coalesce(pr.display_name, '') as display_name,
            pr.username
          from public.group_game_proposal_responses r
          join public.group_members gm
            on gm.group_id = p_proposal.group_id
           and gm.user_id = r.user_id
          join public.profiles pr on pr.id = r.user_id
          left join public.players pl on pl.linked_user_id = r.user_id
          where r.proposal_id = p_proposal.id
        ) listed
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function private.proposal_json(public.group_game_proposals) from public;
revoke all on function private.proposal_json(public.group_game_proposals) from anon;
revoke all on function private.proposal_json(public.group_game_proposals) from authenticated;

create or replace function public.create_group_game_proposal(
  p_group_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location_name text default null,
  p_location_details text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
  v_title text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  v_title := pg_catalog.btrim(coalesce(p_title, ''));
  if v_title = '' or pg_catalog.char_length(v_title) > 80 then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_TIME_INVALID';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_TIME_INVALID';
  end if;

  if p_ends_at - p_starts_at < interval '30 minutes'
     or p_ends_at - p_starts_at > interval '8 hours'
  then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_TIME_INVALID';
  end if;

  if p_starts_at < pg_catalog.now() - interval '12 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_TIME_INVALID';
  end if;

  insert into public.group_game_proposals (
    group_id, created_by, title, starts_at, ends_at,
    location_name, location_details, notes
  )
  values (
    p_group_id,
    v_uid,
    v_title,
    p_starts_at,
    p_ends_at,
    nullif(pg_catalog.btrim(coalesce(p_location_name, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_location_details, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return private.proposal_json(v_row);
end;
$$;

create or replace function public.update_group_game_proposal(
  p_proposal_id uuid,
  p_expected_version bigint,
  p_title text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_location_name text default null,
  p_location_details text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
  v_title text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_row := private.lock_group_proposal(p_proposal_id, p_expected_version);

  if not private.is_group_member(v_row.group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  if not private.can_manage_group_proposal(v_row) then
    raise exception using
      errcode = '42501',
      message = 'PROPOSAL_FORBIDDEN';
  end if;

  if v_row.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_CANCELLED';
  end if;

  if v_row.linked_session_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_ALREADY_LINKED';
  end if;

  v_title := coalesce(nullif(pg_catalog.btrim(coalesce(p_title, '')), ''), v_row.title);
  v_start := coalesce(p_starts_at, v_row.starts_at);
  v_end := coalesce(p_ends_at, v_row.ends_at);

  if v_end <= v_start
     or v_end - v_start < interval '30 minutes'
     or v_end - v_start > interval '8 hours'
  then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_TIME_INVALID';
  end if;

  update public.group_game_proposals
  set
    title = v_title,
    starts_at = v_start,
    ends_at = v_end,
    location_name = case
      when p_location_name is null then location_name
      else nullif(pg_catalog.btrim(p_location_name), '')
    end,
    location_details = case
      when p_location_details is null then location_details
      else nullif(pg_catalog.btrim(p_location_details), '')
    end,
    notes = case
      when p_notes is null then notes
      else nullif(pg_catalog.btrim(p_notes), '')
    end,
    version = version + 1
  where id = v_row.id
  returning * into v_row;

  return private.proposal_json(v_row);
end;
$$;

create or replace function public.cancel_group_game_proposal(
  p_proposal_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_row := private.lock_group_proposal(p_proposal_id, p_expected_version);

  if not private.is_group_member(v_row.group_id)
     or not private.can_manage_group_proposal(v_row)
  then
    raise exception using
      errcode = '42501',
      message = 'PROPOSAL_FORBIDDEN';
  end if;

  if v_row.status = 'cancelled' then
    return private.proposal_json(v_row);
  end if;

  update public.group_game_proposals
  set
    status = 'cancelled',
    cancelled_at = pg_catalog.now(),
    version = version + 1
  where id = v_row.id
  returning * into v_row;

  return private.proposal_json(v_row);
end;
$$;

create or replace function public.confirm_group_game_proposal(
  p_proposal_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_row := private.lock_group_proposal(p_proposal_id, p_expected_version);

  if not private.is_group_member(v_row.group_id)
     or not private.can_manage_group_proposal(v_row)
  then
    raise exception using
      errcode = '42501',
      message = 'PROPOSAL_FORBIDDEN';
  end if;

  if v_row.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_CANCELLED';
  end if;

  if v_row.status = 'confirmed' then
    return private.proposal_json(v_row);
  end if;

  update public.group_game_proposals
  set
    status = 'confirmed',
    confirmed_at = pg_catalog.now(),
    version = version + 1
  where id = v_row.id
  returning * into v_row;

  return private.proposal_json(v_row);
end;
$$;

create or replace function public.respond_to_group_game_proposal(
  p_proposal_id uuid,
  p_response text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
  v_response text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_row := private.lock_group_proposal(p_proposal_id, null);

  if not private.is_group_member(v_row.group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  if v_row.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_CANCELLED';
  end if;

  if v_row.linked_session_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_ALREADY_LINKED';
  end if;

  v_response := pg_catalog.lower(pg_catalog.btrim(coalesce(p_response, '')));
  if v_response not in ('yes', 'maybe', 'no') then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_RESPONSE_INVALID';
  end if;

  insert into public.group_game_proposal_responses (proposal_id, user_id, response)
  values (p_proposal_id, v_uid, v_response)
  on conflict (proposal_id, user_id) do update
    set response = excluded.response;

  select * into v_row from public.group_game_proposals where id = p_proposal_id;
  return private.proposal_json(v_row);
end;
$$;

create or replace function public.get_group_game_proposals(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if not exists (select 1 from public.groups g where g.id = p_group_id) then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_NOT_FOUND';
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  select g.timezone into v_tz from public.groups g where g.id = p_group_id;

  return jsonb_build_object(
    'group_id', p_group_id,
    'timezone', v_tz,
    'proposals',
    coalesce(
      (
        select jsonb_agg(private.proposal_json(p) order by p.starts_at)
        from public.group_game_proposals p
        where p.group_id = p_group_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_group_game_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
  v_tz text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row from public.group_game_proposals where id = p_proposal_id;
  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PROPOSAL_NOT_FOUND';
  end if;

  if not private.is_group_member(v_row.group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  select g.timezone into v_tz from public.groups g where g.id = v_row.group_id;

  return jsonb_build_object(
    'timezone', v_tz,
    'proposal', private.proposal_json(v_row)
  );
end;
$$;

-- Conversion: thin insert matching createCloudSession fields. Trigger adds creator as owner.
-- RSVP does not copy into session_members or session_players.
create or replace function public.create_session_from_group_proposal(
  p_proposal_id uuid,
  p_expected_version bigint,
  p_team_size integer default 2,
  p_team_count integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_game_proposals;
  v_session public.sessions;
  v_tz text;
  v_date date;
  v_attempt integer;
  v_constraint text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_row := private.lock_group_proposal(p_proposal_id, null);

  if not private.is_group_member(v_row.group_id)
     or not private.can_manage_group_proposal(v_row)
  then
    raise exception using
      errcode = '42501',
      message = 'PROPOSAL_FORBIDDEN';
  end if;

  if v_row.linked_session_id is not null then
    return jsonb_build_object(
      'session_id', v_row.linked_session_id,
      'proposal', private.proposal_json(v_row),
      'already_linked', true,
      'structure_version', (
        select s.structure_version from public.sessions s where s.id = v_row.linked_session_id
      )
    );
  end if;

  if p_expected_version is not null and v_row.version is distinct from p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_VERSION_CONFLICT';
  end if;

  if v_row.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_CANCELLED';
  end if;

  if v_row.status is distinct from 'confirmed' then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_FORBIDDEN';
  end if;

  -- Same bounds as public.sessions: team_size between 2 and 6, team_count >= 2, both not null.
  if p_team_size is null or p_team_count is null
     or p_team_size < 2 or p_team_size > 6
     or p_team_count < 2
  then
    raise exception using
      errcode = 'P0001',
      message = 'PROPOSAL_TIME_INVALID';
  end if;

  select g.timezone into v_tz from public.groups g where g.id = v_row.group_id;
  v_date := (v_row.starts_at at time zone v_tz)::date;

  for v_attempt in 1..8 loop
    begin
      insert into public.sessions (
        created_by, date, name, team_size, team_count, status, group_id
      )
      values (
        v_uid, v_date, v_row.title, p_team_size, p_team_count, 'draft', v_row.group_id
      )
      returning * into v_session;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'sessions_join_code_key' then
          raise;
        end if;
        if v_attempt = 8 then
          raise exception using
            errcode = 'P0001',
            message = 'JOIN_CODE_GENERATION_FAILED';
        end if;
    end;
  end loop;

  update public.group_game_proposals
  set
    linked_session_id = v_session.id,
    version = version + 1
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'session_id', v_session.id,
    'proposal', private.proposal_json(v_row),
    'already_linked', false,
    'structure_version', v_session.structure_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership cleanup: drop the leaving member's availability only.
-- ---------------------------------------------------------------------------
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_role := private.group_role(p_group_id);
  if v_role is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_MEMBER_NOT_FOUND';
  end if;

  if v_role = 'owner' and private.group_owner_count(p_group_id) <= 1 then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_LAST_OWNER';
  end if;

  delete from public.group_availability_slots
  where group_id = p_group_id
    and user_id = v_uid;

  delete from public.group_members
  where group_id = p_group_id
    and user_id = v_uid;
end;
$$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caller text;
  v_target text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if p_user_id = v_uid then
    perform public.leave_group(p_group_id);
    return;
  end if;

  v_caller := private.group_role(p_group_id);
  if v_caller not in ('owner', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'GROUP_FORBIDDEN';
  end if;

  select gm.role into v_target
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id;

  if v_target is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_MEMBER_NOT_FOUND';
  end if;

  if v_target = 'owner' then
    raise exception using
      errcode = '42501',
      message = 'GROUP_OWNER_IMMUTABLE';
  end if;

  if v_caller = 'admin' and v_target <> 'member' then
    raise exception using
      errcode = '42501',
      message = 'GROUP_FORBIDDEN';
  end if;

  delete from public.group_availability_slots
  where group_id = p_group_id
    and user_id = p_user_id;

  delete from public.group_members
  where group_id = p_group_id
    and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.create_group_game_proposal(uuid, text, timestamptz, timestamptz, text, text, text) from public;
revoke all on function public.create_group_game_proposal(uuid, text, timestamptz, timestamptz, text, text, text) from anon;
grant execute on function public.create_group_game_proposal(uuid, text, timestamptz, timestamptz, text, text, text) to authenticated;

revoke all on function public.update_group_game_proposal(uuid, bigint, text, timestamptz, timestamptz, text, text, text) from public;
revoke all on function public.update_group_game_proposal(uuid, bigint, text, timestamptz, timestamptz, text, text, text) from anon;
grant execute on function public.update_group_game_proposal(uuid, bigint, text, timestamptz, timestamptz, text, text, text) to authenticated;

revoke all on function public.cancel_group_game_proposal(uuid, bigint) from public;
revoke all on function public.cancel_group_game_proposal(uuid, bigint) from anon;
grant execute on function public.cancel_group_game_proposal(uuid, bigint) to authenticated;

revoke all on function public.confirm_group_game_proposal(uuid, bigint) from public;
revoke all on function public.confirm_group_game_proposal(uuid, bigint) from anon;
grant execute on function public.confirm_group_game_proposal(uuid, bigint) to authenticated;

revoke all on function public.respond_to_group_game_proposal(uuid, text) from public;
revoke all on function public.respond_to_group_game_proposal(uuid, text) from anon;
grant execute on function public.respond_to_group_game_proposal(uuid, text) to authenticated;

revoke all on function public.get_group_game_proposals(uuid) from public;
revoke all on function public.get_group_game_proposals(uuid) from anon;
grant execute on function public.get_group_game_proposals(uuid) to authenticated;

revoke all on function public.get_group_game_proposal(uuid) from public;
revoke all on function public.get_group_game_proposal(uuid) from anon;
grant execute on function public.get_group_game_proposal(uuid) to authenticated;

revoke all on function public.create_session_from_group_proposal(uuid, bigint, integer, integer) from public;
revoke all on function public.create_session_from_group_proposal(uuid, bigint, integer, integer) from anon;
grant execute on function public.create_session_from_group_proposal(uuid, bigint, integer, integer) to authenticated;
