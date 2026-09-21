-- Cloud groups (etapa 4).
-- group_members != session_members != session_players.
-- Entrar no grupo não concede acesso a encontros nem coloca ninguém no elenco.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  join_code text not null unique
    check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint groups_name_not_blank check (pg_catalog.btrim(name) <> '')
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (group_id, user_id)
);

alter table public.sessions
  add column if not exists group_id uuid references public.groups (id) on delete set null;

create index if not exists sessions_group_id_idx on public.sessions (group_id);
create index if not exists group_members_user_id_idx on public.group_members (user_id);

-- Join codes of sessions and groups share the same alphabet; avoid collisions.
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
-- Helpers (SECURITY DEFINER: policies must not recurse into group_members)
-- ---------------------------------------------------------------------------
create or replace function private.group_role(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select gm.role
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = auth.uid()
  limit 1;
$$;

create or replace function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.group_role(p_group_id) is not null;
$$;

create or replace function private.can_manage_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.group_role(p_group_id) in ('owner', 'admin');
$$;

create or replace function private.group_owner_count(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.role = 'owner';
$$;

revoke all on function private.group_role(uuid) from public;
revoke all on function private.is_group_member(uuid) from public;
revoke all on function private.can_manage_group(uuid) from public;
revoke all on function private.group_owner_count(uuid) from public;

grant execute on function private.group_role(uuid) to authenticated;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.can_manage_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function private.prepare_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_NAME_REQUIRED';
  end if;

  if new.description is not null then
    new.description := nullif(pg_catalog.btrim(new.description), '');
  end if;

  if new.join_code is null or pg_catalog.btrim(new.join_code) = '' then
    new.join_code := private.generate_join_code();
  else
    new.join_code := private.normalize_join_code(new.join_code);
  end if;

  return new;
end;
$$;

create or replace function private.add_group_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create or replace function private.protect_group_audit_fields()
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
     and current_setting('private.allow_group_join_code_rotate', true) is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_JOIN_CODE_ROTATE_REQUIRED';
  end if;

  return new;
end;
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

  if new.group_id is distinct from old.group_id then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_ID_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function private.set_updated_at();

drop trigger if exists groups_prepare_insert on public.groups;
create trigger groups_prepare_insert
  before insert on public.groups
  for each row execute function private.prepare_new_group();

drop trigger if exists groups_add_owner on public.groups;
create trigger groups_add_owner
  after insert on public.groups
  for each row execute function private.add_group_owner();

drop trigger if exists groups_protect_audit on public.groups;
create trigger groups_protect_audit
  before update on public.groups
  for each row execute function private.protect_group_audit_fields();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_description text default null)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups;
  v_attempt integer;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  for v_attempt in 1..8 loop
    begin
      insert into public.groups (created_by, name, description)
      values (v_uid, p_name, p_description)
      returning * into v_group;
      return v_group;
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

create or replace function public.join_group_by_code(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_group_id uuid;
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

  select g.id into v_group_id
  from public.groups g
  where g.join_code = v_code;

  if v_group_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_JOIN_CODE_NOT_FOUND';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

create or replace function public.rotate_group_join_code(p_group_id uuid)
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

  if not private.can_manage_group(p_group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_JOIN_CODE_ROTATE_FORBIDDEN';
  end if;

  for v_attempt in 1..8 loop
    begin
      v_code := private.generate_join_code();
      perform set_config('private.allow_group_join_code_rotate', 'true', true);
      update public.groups
      set join_code = v_code
      where id = p_group_id;
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

create or replace function public.update_group(
  p_group_id uuid,
  p_name text,
  p_description text default null
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups;
  v_name text;
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

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_NAME_REQUIRED';
  end if;

  update public.groups
  set
    name = v_name,
    description = nullif(pg_catalog.btrim(coalesce(p_description, '')), '')
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

create or replace function public.set_group_member_role(
  p_group_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caller text;
  v_target text;
  v_role text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_role := pg_catalog.lower(pg_catalog.btrim(coalesce(p_role, '')));
  if v_role not in ('admin', 'member') then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_ROLE_INVALID';
  end if;

  v_caller := private.group_role(p_group_id);
  if v_caller not in ('owner', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'GROUP_FORBIDDEN';
  end if;

  if p_user_id = v_uid then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ROLE_FORBIDDEN';
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

  update public.group_members
  set role = v_role
  where group_id = p_group_id
    and user_id = p_user_id;
end;
$$;

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

  delete from public.group_members
  where group_id = p_group_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.create_group(text, text) from public;
revoke all on function public.create_group(text, text) from anon;
revoke all on function public.join_group_by_code(text) from public;
revoke all on function public.join_group_by_code(text) from anon;
revoke all on function public.rotate_group_join_code(uuid) from public;
revoke all on function public.rotate_group_join_code(uuid) from anon;
revoke all on function public.update_group(uuid, text, text) from public;
revoke all on function public.update_group(uuid, text, text) from anon;
revoke all on function public.set_group_member_role(uuid, uuid, text) from public;
revoke all on function public.set_group_member_role(uuid, uuid, text) from anon;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.leave_group(uuid) from anon;
revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.remove_group_member(uuid, uuid) from anon;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
grant execute on function public.rotate_group_join_code(uuid) to authenticated;
grant execute on function public.update_group(uuid, text, text) to authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants (table): SELECT only. Mutations go through RPCs.
-- ---------------------------------------------------------------------------
grant select on table public.groups to authenticated;
grant select on table public.group_members to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.groups force row level security;
alter table public.group_members enable row level security;
alter table public.group_members force row level security;

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (private.is_group_member(id));

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update to authenticated
  using (private.can_manage_group(id))
  with check (private.can_manage_group(id));

drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      group_id is null
      or private.is_group_member(group_id)
    )
  );
