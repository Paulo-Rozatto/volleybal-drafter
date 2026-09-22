-- Comunidade Beta (etapa 10). Amigos, perfis sociais, stats globais, chat de grupo.
-- friends != group_members != session_members != session_players
--   != competition_members != competition_players.
-- Amizade não concede acesso a encontro, competição, grupo nem elenco.
-- Do not apply on hosted Supabase until this migration is reviewed.
-- Do not db push from the app repo.

-- ---------------------------------------------------------------------------
-- Profiles: username + avatar_path
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username text,
  add column if not exists avatar_path text;

create or replace function private.normalize_username_seed(p_seed text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text;
begin
  cleaned := pg_catalog.lower(coalesce(p_seed, ''));
  cleaned := pg_catalog.regexp_replace(cleaned, '[^a-z0-9_]', '', 'g');
  if pg_catalog.length(cleaned) < 3 then
    if cleaned = '' then
      return 'jogador';
    end if;
    cleaned := pg_catalog.rpad(cleaned, 3, 'x');
  end if;
  if pg_catalog.length(cleaned) > 20 then
    cleaned := pg_catalog.substr(cleaned, 1, 20);
  end if;
  return cleaned;
end;
$$;

create or replace function private.allocate_username(p_seed text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix integer;
  token text;
begin
  base := private.normalize_username_seed(p_seed);
  if not exists (select 1 from public.profiles p where p.username = base) then
    return base;
  end if;

  for suffix in 2..99 loop
    candidate := pg_catalog.substr(base, 1, 21) || suffix::text;
    if pg_catalog.length(candidate) > 24 then
      candidate := pg_catalog.substr(candidate, 1, 24);
    end if;
    if candidate ~ '^[a-z0-9_]{3,24}$'
       and not exists (select 1 from public.profiles p where p.username = candidate)
    then
      return candidate;
    end if;
  end loop;

  token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  candidate := 'u' || pg_catalog.substr(token, 1, 23);
  return candidate;
end;
$$;

revoke all on function private.normalize_username_seed(text) from public;
revoke all on function private.normalize_username_seed(text) from anon;
revoke all on function private.normalize_username_seed(text) from authenticated;
revoke all on function private.allocate_username(text) from public;
revoke all on function private.allocate_username(text) from anon;
revoke all on function private.allocate_username(text) from authenticated;

create or replace function private.random_social_username()
returns text
language plpgsql
set search_path = ''
as $$
declare
  token text;
  candidate text;
begin
  token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  candidate := 'jogador_' || pg_catalog.substr(token, 1, 8);
  if candidate ~ '^[a-z0-9_]{3,24}$'
     and not exists (select 1 from public.profiles p where p.username = candidate)
  then
    return candidate;
  end if;
  return 'u' || pg_catalog.substr(token, 1, 23);
end;
$$;

revoke all on function private.random_social_username() from public;
revoke all on function private.random_social_username() from anon;
revoke all on function private.random_social_username() from authenticated;

-- Etapa 1 (20260921120000_cloud_sessions.sql) handle_new_user usava
-- split_part(new.email, '@', 1) como display_name quando metadata.display_name
-- estava vazio. Essa migration antiga permanece congelada.
-- Profiles já existentes com display_name igual ao e-mail ou ao local-part,
-- e sem display_name escolhido em metadata, NÃO são globalizados: viram 'Jogador'
-- antes de alocar username público.
update public.profiles p
set display_name = 'Jogador'
from auth.users u
where u.id = p.id
  and pg_catalog.btrim(coalesce(u.raw_user_meta_data->>'display_name', '')) = ''
  and (
    p.display_name = pg_catalog.split_part(coalesce(u.email, ''), '@', 1)
    or p.display_name = coalesce(u.email, '')
  );

update public.profiles p
set username = private.allocate_username(coalesce(nullif(p.display_name, ''), 'jogador'))
where p.username is null;

alter table public.profiles
  alter column username set not null;

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,24}$');

create unique index if not exists profiles_username_uidx
  on public.profiles (username);

create or replace function private.protect_profile_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.username := pg_catalog.lower(pg_catalog.btrim(coalesce(new.username, '')));
  if new.username !~ '^[a-z0-9_]{3,24}$' then
    raise exception using
      errcode = 'P0001',
      message = 'USERNAME_INVALID';
  end if;

  new.display_name := pg_catalog.btrim(coalesce(new.display_name, ''));

  if new.avatar_path is not null then
    new.avatar_path := pg_catalog.btrim(new.avatar_path);
    if new.avatar_path = '' then
      new.avatar_path := null;
    elsif new.avatar_path not like (new.id::text || '/%') then
      raise exception using
        errcode = 'P0001',
        message = 'AVATAR_PATH_INVALID';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception using
      errcode = 'P0001',
      message = 'PROFILE_ID_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_social on public.profiles;
create trigger profiles_protect_social
  before insert or update on public.profiles
  for each row
  execute function private.protect_profile_social();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_name text;
  display text;
  candidate text;
  attempt integer;
  v_constraint text;
begin
  -- Identidade pública NÃO deriva de e-mail, telefone nem metadata sensível.
  meta_name := pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'display_name', ''));
  display := coalesce(nullif(meta_name, ''), 'Jogador');

  for attempt in 1..12 loop
    if attempt = 1 and meta_name <> '' then
      candidate := private.allocate_username(meta_name);
    else
      candidate := private.random_social_username();
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.abs(('x' || pg_catalog.substr(pg_catalog.md5('username:' || candidate), 1, 16))::bit(64)::bigint)
    );

    begin
      insert into public.profiles (id, display_name, username)
      values (new.id, display, candidate);
      return new;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'profiles_username_uidx'
           or pg_catalog.strpos(sqlerrm, 'profiles_username_uidx') > 0
        then
          continue;
        end if;
        raise;
    end;
  end loop;

  raise exception using
    errcode = 'P0001',
    message = 'USERNAME_ALLOCATION_FAILED';
end;
$$;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_select_authenticated on public.profiles;

-- Leitura autenticada só das colunas sociais. Colunas novas (e-mail, etc.)
-- não passam a ser globais só porque a policy é USING (true).
-- profiles_update_self da etapa 1 permanece, mas sem GRANT UPDATE:
-- atualização só pela RPC update_my_social_profile.
create policy profiles_select_authenticated on public.profiles
  for select to authenticated
  using (true);

revoke select, update on table public.profiles from public;
revoke select, update on table public.profiles from anon;
revoke select, update on table public.profiles from authenticated;
grant select (id, display_name, username, avatar_path)
  on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Friend requests (relação social apenas)
-- ---------------------------------------------------------------------------
create table public.friend_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  sender_user_id uuid not null references public.profiles (id) on delete cascade,
  receiver_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint friend_requests_not_self check (sender_user_id <> receiver_user_id)
);

create unique index friend_requests_active_pair_uidx
  on public.friend_requests (
    least(sender_user_id, receiver_user_id),
    greatest(sender_user_id, receiver_user_id)
  )
  where status in ('pending', 'accepted');

create index friend_requests_receiver_status_idx
  on public.friend_requests (receiver_user_id, status, created_at desc);

create index friend_requests_sender_status_idx
  on public.friend_requests (sender_user_id, status, created_at desc);

drop trigger if exists friend_requests_set_updated_at on public.friend_requests;
create trigger friend_requests_set_updated_at
  before update on public.friend_requests
  for each row
  execute function private.set_updated_at();

alter table public.friend_requests enable row level security;
alter table public.friend_requests force row level security;

create policy friend_requests_select_own on public.friend_requests
  for select to authenticated
  using (sender_user_id = auth.uid() or receiver_user_id = auth.uid());

grant select on table public.friend_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Group chat
-- ---------------------------------------------------------------------------
create table public.group_messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  sender_user_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default pg_catalog.now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index group_messages_group_created_idx
  on public.group_messages (group_id, created_at, id);

create or replace function private.protect_group_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trimmed text;
begin
  if tg_op = 'INSERT' then
    new.sender_user_id := auth.uid();
    if new.sender_user_id is null then
      raise exception using
        errcode = '42501',
        message = 'AUTH_REQUIRED';
    end if;
    if not private.is_group_member(new.group_id) then
      raise exception using
        errcode = '42501',
        message = 'GROUP_ACCESS_DENIED';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.sender_user_id is distinct from old.sender_user_id
       or new.group_id is distinct from old.group_id
       or new.created_at is distinct from old.created_at
       or new.id is distinct from old.id then
      raise exception using
        errcode = 'P0001',
        message = 'GROUP_MESSAGE_IMMUTABLE';
    end if;
    if old.sender_user_id is distinct from auth.uid() then
      raise exception using
        errcode = '42501',
        message = 'GROUP_MESSAGE_FORBIDDEN';
    end if;
    if not private.is_group_member(old.group_id) then
      raise exception using
        errcode = '42501',
        message = 'GROUP_ACCESS_DENIED';
    end if;
    if old.deleted_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'GROUP_MESSAGE_DELETED';
    end if;
  end if;

  if new.deleted_at is not null then
    new.body := '';
    return new;
  end if;

  trimmed := pg_catalog.btrim(coalesce(new.body, ''));
  if trimmed = '' or pg_catalog.char_length(trimmed) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_MESSAGE_INVALID';
  end if;
  new.body := trimmed;

  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.edited_at := pg_catalog.now();
  end if;

  return new;
end;
$$;

drop trigger if exists group_messages_protect on public.group_messages;
create trigger group_messages_protect
  before insert or update on public.group_messages
  for each row
  execute function private.protect_group_message();

alter table public.group_messages enable row level security;
alter table public.group_messages force row level security;

create policy group_messages_select_member on public.group_messages
  for select to authenticated
  using (private.is_group_member(group_id));

-- Escrita somente por RPC (send/edit/delete_group_message).
-- Policies INSERT/UPDATE removidas: sem GRANT, o role authenticated não alcança a tabela.
drop policy if exists group_messages_insert_member on public.group_messages;
drop policy if exists group_messages_update_own on public.group_messages;

revoke insert, update, delete on table public.group_messages from public;
revoke insert, update, delete on table public.group_messages from anon;
revoke insert, update, delete on table public.group_messages from authenticated;
grant select on table public.group_messages to authenticated;

do $realtime_chat$
begin
  alter table public.group_messages replica identity full;
  alter publication supabase_realtime add table public.group_messages;
exception
  when duplicate_object then
    null;
  when undefined_object then
    null;
  when insufficient_privilege then
    null;
end;
$realtime_chat$;

-- ---------------------------------------------------------------------------
-- Storage avatars (hosted Supabase only; skipped when storage schema is absent)
-- ---------------------------------------------------------------------------
do $avatars$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    false,
    524288,
    array['image/jpeg', 'image/png', 'image/webp']
  )
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  execute $sql$
    drop policy if exists avatars_select_authenticated on storage.objects;
    drop policy if exists avatars_insert_own on storage.objects;
    drop policy if exists avatars_update_own on storage.objects;
    drop policy if exists avatars_delete_own on storage.objects;

    create policy avatars_select_authenticated on storage.objects
      for select to authenticated
      using (bucket_id = 'avatars');

    create policy avatars_insert_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and split_part(name, '/', 1) = auth.uid()::text
      );

    create policy avatars_update_own on storage.objects
      for update to authenticated
      using (
        bucket_id = 'avatars'
        and split_part(name, '/', 1) = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and split_part(name, '/', 1) = auth.uid()::text
      );

    create policy avatars_delete_own on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'avatars'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  $sql$;
end;
$avatars$;

-- ---------------------------------------------------------------------------
-- Social profile helpers
-- ---------------------------------------------------------------------------
create or replace function private.social_player_json(p_player public.players)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', pr.id,
    'username', pr.username,
    'display_name', coalesce(pr.display_name, ''),
    'avatar_path', pr.avatar_path,
    'player_id', p_player.id,
    'player_name', p_player.name
  )
  from public.profiles pr
  where pr.id = p_player.linked_user_id;
$$;

revoke all on function private.social_player_json(public.players) from public;
revoke all on function private.social_player_json(public.players) from anon;
revoke all on function private.social_player_json(public.players) from authenticated;

-- Fato esportivo global: quem jogou, data, placar, lineups, session vs competition.
-- Sem metadado privado da organização (nome, IDs internos, legacy, group, join code).
create or replace function private.social_opaque_token(p_scope text, p_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.md5(coalesce(p_scope, '') || ':' || coalesce(p_id, ''));
$$;

revoke all on function private.social_opaque_token(text, text) from public;
revoke all on function private.social_opaque_token(text, text) from anon;
revoke all on function private.social_opaque_token(text, text) from authenticated;

create or replace function private.social_match_json(
  p_kind text,
  p_entity_id uuid,
  p_legacy_source_id text,
  p_match_id uuid,
  p_round_id uuid,
  p_date date,
  p_round_number integer,
  p_cycle_number integer,
  p_score_a integer,
  p_score_b integer,
  p_lineup_a jsonb,
  p_lineup_b jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'source_kind', p_kind,
    'social_match_id', private.social_opaque_token('match', p_kind || ':' || p_match_id::text),
    'source_token', private.social_opaque_token('source', p_kind || ':' || p_entity_id::text),
    'origin_key', private.social_opaque_token(
      'origin',
      p_kind || ':' || coalesce(nullif(p_legacy_source_id, ''), p_entity_id::text)
    ),
    'round_token', private.social_opaque_token('round', p_kind || ':' || p_round_id::text),
    'date', p_date,
    'round_number', p_round_number,
    'cycle_number', p_cycle_number,
    'score_a', p_score_a,
    'score_b', p_score_b,
    'lineup_a', coalesce(p_lineup_a, '[]'::jsonb),
    'lineup_b', coalesce(p_lineup_b, '[]'::jsonb)
  );
$$;

revoke all on function private.social_match_json(
  text, uuid, text, uuid, uuid, date, integer, integer, integer, integer, jsonb, jsonb
) from public;
revoke all on function private.social_match_json(
  text, uuid, text, uuid, uuid, date, integer, integer, integer, integer, jsonb, jsonb
) from anon;
revoke all on function private.social_match_json(
  text, uuid, text, uuid, uuid, date, integer, integer, integer, integer, jsonb, jsonb
) from authenticated;

create or replace function private.player_matches_payload(p_player_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_agg(payload order by sort_date desc, source_key, round_number, match_id)
      from (
        select
          s.date as sort_date,
          ('session:' || s.id::text) as source_key,
          r.number as round_number,
          m.id as match_id,
          private.social_match_json(
            'session',
            s.id,
            s.legacy_source_id,
            m.id,
            r.id,
            s.date,
            r.number,
            r.cycle_number,
            m.score_a,
            m.score_b,
            coalesce(
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
            coalesce(
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
          where mine.player_id = p_player_id
            and mine.match_id = m.id
        )
        group by
          m.id, m.score_a, m.score_b, s.id, s.date, s.legacy_source_id, r.id, r.number, r.cycle_number
        union all
        select
          coalesce(cm.played_date, c.date) as sort_date,
          ('competition:' || c.id::text) as source_key,
          cr.number as round_number,
          cm.id as match_id,
          private.social_match_json(
            'competition',
            c.id,
            c.legacy_source_id,
            cm.id,
            cr.id,
            coalesce(cm.played_date, c.date),
            cr.number,
            null,
            cm.score_a,
            cm.score_b,
            coalesce(
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
            coalesce(
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
          where mine.player_id = p_player_id
            and mine.match_id = cm.id
        )
        group by
          cm.id, cm.score_a, cm.score_b, cm.played_date, c.id, c.date, c.legacy_source_id, cr.id, cr.number
      ) grouped
    ),
    '[]'::jsonb
  );
$$;

revoke all on function private.player_matches_payload(uuid) from public;
revoke all on function private.player_matches_payload(uuid) from anon;
revoke all on function private.player_matches_payload(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Friend RPCs
-- ---------------------------------------------------------------------------
create or replace function private.friendship_state(p_other uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select
        case
          when fr.status = 'accepted' then 'friends'
          when fr.status = 'pending' and fr.sender_user_id = auth.uid() then 'outgoing_pending'
          when fr.status = 'pending' and fr.receiver_user_id = auth.uid() then 'incoming_pending'
          else 'none'
        end
      from public.friend_requests fr
      where fr.status in ('pending', 'accepted')
        and (
          (fr.sender_user_id = auth.uid() and fr.receiver_user_id = p_other)
          or (fr.receiver_user_id = auth.uid() and fr.sender_user_id = p_other)
        )
      order by case fr.status when 'accepted' then 0 else 1 end
      limit 1
    ),
    'none'
  );
$$;

revoke all on function private.friendship_state(uuid) from public;
revoke all on function private.friendship_state(uuid) from anon;
revoke all on function private.friendship_state(uuid) from authenticated;

create or replace function public.search_users_for_friendship(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  v_q := pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, '')));
  v_q := pg_catalog.replace(v_q, '@', '');
  v_q := pg_catalog.regexp_replace(v_q, '[%_]', '', 'g');
  if pg_catalog.length(v_q) < 2 then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(row_json order by username)
      from (
        select jsonb_build_object(
          'user_id', pr.id,
          'username', pr.username,
          'display_name', coalesce(pr.display_name, ''),
          'avatar_path', pr.avatar_path,
          'player_id', pl.id,
          'player_name', pl.name,
          'friendship_state', private.friendship_state(pr.id)
        ) as row_json,
        pr.username
        from public.profiles pr
        left join public.players pl on pl.linked_user_id = pr.id
        where pr.id <> v_uid
          and (
            pr.username like v_q || '%'
            or pr.username like '%' || v_q || '%'
            or pg_catalog.lower(coalesce(pr.display_name, '')) like '%' || v_q || '%'
          )
        order by
          case when pr.username = v_q then 0 when pr.username like v_q || '%' then 1 else 2 end,
          pr.username
        limit 20
      ) ranked
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.send_friend_request(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests;
  v_constraint text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if p_user_id is null or p_user_id = v_uid then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_SELF';
  end if;

  if not exists (select 1 from public.profiles pr where pr.id = p_user_id) then
    raise exception using
      errcode = 'P0002',
      message = 'FRIEND_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.abs(('x' || pg_catalog.substr(pg_catalog.md5(
      case when v_uid::text < p_user_id::text then v_uid::text else p_user_id::text end
      || ':' ||
      case when v_uid::text < p_user_id::text then p_user_id::text else v_uid::text end
    ), 1, 16))::bit(64)::bigint)
  );

  if exists (
    select 1
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.sender_user_id = v_uid and fr.receiver_user_id = p_user_id)
        or (fr.sender_user_id = p_user_id and fr.receiver_user_id = v_uid)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_ALREADY';
  end if;

  if exists (
    select 1
    from public.friend_requests fr
    where fr.status = 'pending'
      and (
        (fr.sender_user_id = v_uid and fr.receiver_user_id = p_user_id)
        or (fr.sender_user_id = p_user_id and fr.receiver_user_id = v_uid)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_REQUEST_PENDING';
  end if;

  begin
    insert into public.friend_requests (sender_user_id, receiver_user_id, status)
    values (v_uid, p_user_id, 'pending')
    returning * into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'friend_requests_active_pair_uidx'
         and pg_catalog.strpos(sqlerrm, 'friend_requests_active_pair_uidx') = 0
      then
        raise;
      end if;
      if exists (
        select 1
        from public.friend_requests fr
        where fr.status = 'accepted'
          and (
            (fr.sender_user_id = v_uid and fr.receiver_user_id = p_user_id)
            or (fr.sender_user_id = p_user_id and fr.receiver_user_id = v_uid)
          )
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'FRIEND_ALREADY';
      end if;
      raise exception using
        errcode = 'P0001',
        message = 'FRIEND_REQUEST_PENDING';
  end;

  return jsonb_build_object(
    'id', v_row.id,
    'sender_user_id', v_row.sender_user_id,
    'receiver_user_id', v_row.receiver_user_id,
    'status', v_row.status,
    'created_at', v_row.created_at
  );
end;
$$;

create or replace function public.accept_friend_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row
  from public.friend_requests
  where id = p_request_id
  for update;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'FRIEND_REQUEST_NOT_FOUND';
  end if;

  if v_row.receiver_user_id is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'FRIEND_REQUEST_FORBIDDEN';
  end if;

  if v_row.status is distinct from 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_REQUEST_NOT_PENDING';
  end if;

  update public.friend_requests
  set status = 'accepted'
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'sender_user_id', v_row.sender_user_id,
    'receiver_user_id', v_row.receiver_user_id,
    'status', v_row.status
  );
end;
$$;

create or replace function public.reject_friend_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row from public.friend_requests where id = p_request_id for update;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'FRIEND_REQUEST_NOT_FOUND';
  end if;

  if v_row.receiver_user_id is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'FRIEND_REQUEST_FORBIDDEN';
  end if;

  if v_row.status is distinct from 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_REQUEST_NOT_PENDING';
  end if;

  update public.friend_requests
  set status = 'rejected'
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status
  );
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row from public.friend_requests where id = p_request_id for update;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'FRIEND_REQUEST_NOT_FOUND';
  end if;

  if v_row.sender_user_id is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'FRIEND_REQUEST_FORBIDDEN';
  end if;

  if v_row.status is distinct from 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_REQUEST_NOT_PENDING';
  end if;

  update public.friend_requests
  set status = 'cancelled'
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status
  );
end;
$$;

create or replace function public.remove_friendship(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  if p_user_id is null or p_user_id = v_uid then
    raise exception using
      errcode = 'P0001',
      message = 'FRIEND_SELF';
  end if;

  select * into v_row
  from public.friend_requests
  where status = 'accepted'
    and (
      (sender_user_id = v_uid and receiver_user_id = p_user_id)
      or (sender_user_id = p_user_id and receiver_user_id = v_uid)
    )
  for update;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'FRIENDSHIP_NOT_FOUND';
  end if;

  delete from public.friend_requests where id = v_row.id;

  return jsonb_build_object('ok', true, 'removed_user_id', p_user_id);
end;
$$;

create or replace function public.list_my_friends()
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
      select jsonb_agg(row_json order by display_name, username)
      from (
        select jsonb_build_object(
          'user_id', pr.id,
          'username', pr.username,
          'display_name', coalesce(pr.display_name, ''),
          'avatar_path', pr.avatar_path,
          'player_id', pl.id,
          'player_name', pl.name,
          'friendship_state', 'friends'
        ) as row_json,
        coalesce(pr.display_name, '') as display_name,
        pr.username
        from public.friend_requests fr
        join public.profiles pr
          on pr.id = case
            when fr.sender_user_id = v_uid then fr.receiver_user_id
            else fr.sender_user_id
          end
        left join public.players pl on pl.linked_user_id = pr.id
        where fr.status = 'accepted'
          and (fr.sender_user_id = v_uid or fr.receiver_user_id = v_uid)
      ) friends
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.list_my_friend_requests()
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
    'incoming',
    coalesce(
      (
        select jsonb_agg(row_json order by created_at desc)
        from (
          select jsonb_build_object(
            'id', fr.id,
            'user_id', pr.id,
            'username', pr.username,
            'display_name', coalesce(pr.display_name, ''),
            'avatar_path', pr.avatar_path,
            'player_id', pl.id,
            'player_name', pl.name,
            'friendship_state', 'incoming_pending',
            'created_at', fr.created_at
          ) as row_json,
          fr.created_at
          from public.friend_requests fr
          join public.profiles pr on pr.id = fr.sender_user_id
          left join public.players pl on pl.linked_user_id = pr.id
          where fr.receiver_user_id = v_uid
            and fr.status = 'pending'
        ) incoming
      ),
      '[]'::jsonb
    ),
    'outgoing',
    coalesce(
      (
        select jsonb_agg(row_json order by created_at desc)
        from (
          select jsonb_build_object(
            'id', fr.id,
            'user_id', pr.id,
            'username', pr.username,
            'display_name', coalesce(pr.display_name, ''),
            'avatar_path', pr.avatar_path,
            'player_id', pl.id,
            'player_name', pl.name,
            'friendship_state', 'outgoing_pending',
            'created_at', fr.created_at
          ) as row_json,
          fr.created_at
          from public.friend_requests fr
          join public.profiles pr on pr.id = fr.receiver_user_id
          left join public.players pl on pl.linked_user_id = pr.id
          where fr.sender_user_id = v_uid
            and fr.status = 'pending'
        ) outgoing
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Social profile + global read model
-- ---------------------------------------------------------------------------
create or replace function public.update_my_social_profile(
  p_display_name text default null,
  p_username text default null,
  p_avatar_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_constraint text;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row from public.profiles where id = v_uid for update;
  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PROFILE_NOT_FOUND';
  end if;

  if p_username is not null then
    if exists (
      select 1
      from public.profiles other
      where other.username = pg_catalog.lower(pg_catalog.btrim(p_username))
        and other.id <> v_uid
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'USERNAME_TAKEN';
    end if;
  end if;

  begin
    update public.profiles
    set
      display_name = coalesce(p_display_name, display_name),
      username = coalesce(p_username, username),
      avatar_path = case
        when p_avatar_path is null then avatar_path
        when pg_catalog.btrim(p_avatar_path) = '' then null
        else p_avatar_path
      end,
      updated_at = pg_catalog.now()
    where id = v_uid
    returning * into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'profiles_username_uidx'
         or pg_catalog.strpos(sqlerrm, 'profiles_username_uidx') > 0
      then
        raise exception using
          errcode = 'P0001',
          message = 'USERNAME_TAKEN';
      end if;
      raise;
  end;

  return jsonb_build_object(
    'user_id', v_row.id,
    'username', v_row.username,
    'display_name', coalesce(v_row.display_name, ''),
    'avatar_path', v_row.avatar_path
  );
end;
$$;

create or replace function public.get_my_social_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PROFILE_NOT_FOUND';
  end if;

  select * into v_player from public.players where linked_user_id = v_uid;

  return jsonb_build_object(
    'user_id', v_profile.id,
    'username', v_profile.username,
    'display_name', coalesce(v_profile.display_name, ''),
    'avatar_path', v_profile.avatar_path,
    'player_id', v_player.id,
    'player_name', v_player.name
  );
end;
$$;

create or replace function public.get_social_player_profile(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players;
  v_profile jsonb;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_player from public.players where id = p_player_id;
  if v_player.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'PLAYER_NOT_FOUND';
  end if;

  if v_player.linked_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_PROFILE_UNAVAILABLE';
  end if;

  v_profile := private.social_player_json(v_player);

  return jsonb_build_object(
    'profile', v_profile,
    'player', jsonb_build_object(
      'id', v_player.id,
      'name', v_player.name
    ),
    'matches', private.player_matches_payload(v_player.id)
  );
end;
$$;

create or replace function public.get_global_performance_matches()
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
    'players',
    coalesce(
      (
        select jsonb_agg(player_row order by display_name, username)
        from (
          select
            jsonb_build_object(
              'user_id', pr.id,
              'username', pr.username,
              'display_name', coalesce(pr.display_name, ''),
              'avatar_path', pr.avatar_path,
              'player_id', pl.id,
              'player_name', pl.name
            ) as player_row,
            coalesce(pr.display_name, '') as display_name,
            pr.username
          from public.players pl
          join public.profiles pr on pr.id = pl.linked_user_id
          where pl.linked_user_id is not null
            and pl.archived_at is null
        ) linked
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
            private.social_match_json(
              'session',
              s.id,
              s.legacy_source_id,
              m.id,
              r.id,
              s.date,
              r.number,
              r.cycle_number,
              m.score_a,
              m.score_b,
              coalesce(
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
              coalesce(
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
            from public.match_players linked_mp
            join public.players linked_pl on linked_pl.id = linked_mp.player_id
            where linked_mp.match_id = m.id
              and linked_pl.linked_user_id is not null
          )
          group by
            m.id, m.score_a, m.score_b, s.id, s.date, s.legacy_source_id, r.id, r.number, r.cycle_number
          union all
          select
            coalesce(cm.played_date, c.date) as sort_date,
            ('competition:' || c.id::text) as source_key,
            cr.number as round_number,
            cm.id as match_id,
            private.social_match_json(
              'competition',
              c.id,
              c.legacy_source_id,
              cm.id,
              cr.id,
              coalesce(cm.played_date, c.date),
              cr.number,
              null,
              cm.score_a,
              cm.score_b,
              coalesce(
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
              coalesce(
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
            from public.competition_match_players linked_cmp
            join public.players linked_pl on linked_pl.id = linked_cmp.player_id
            where linked_cmp.match_id = cm.id
              and linked_pl.linked_user_id is not null
          )
          group by
            cm.id, cm.score_a, cm.score_b, cm.played_date, c.id, c.date, c.legacy_source_id, cr.id, cr.number
        ) grouped
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- Ranking de grupo continua contextual: private.is_group_member é exigido
-- e o payload pode incluir nome/IDs do encontro e da competição do grupo.
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
              'username', p.username,
              'avatar_path', p.avatar_path,
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
-- Chat RPCs (sender always auth.uid() via trigger)
-- ---------------------------------------------------------------------------
create or replace function public.send_group_message(p_group_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_messages;
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

  insert into public.group_messages (group_id, sender_user_id, body)
  values (p_group_id, v_uid, p_body)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'group_id', v_row.group_id,
    'sender_user_id', v_row.sender_user_id,
    'body', v_row.body,
    'created_at', v_row.created_at,
    'edited_at', v_row.edited_at,
    'deleted_at', v_row.deleted_at
  );
end;
$$;

create or replace function public.edit_group_message(p_message_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_messages;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row from public.group_messages where id = p_message_id;
  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_MESSAGE_NOT_FOUND';
  end if;

  if not private.is_group_member(v_row.group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  if v_row.sender_user_id is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'GROUP_MESSAGE_FORBIDDEN';
  end if;

  if v_row.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_MESSAGE_DELETED';
  end if;

  update public.group_messages
  set body = p_body,
      edited_at = pg_catalog.now()
  where id = p_message_id
    and sender_user_id = v_uid
    and deleted_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_MESSAGE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'group_id', v_row.group_id,
    'sender_user_id', v_row.sender_user_id,
    'body', v_row.body,
    'created_at', v_row.created_at,
    'edited_at', v_row.edited_at,
    'deleted_at', v_row.deleted_at
  );
end;
$$;

create or replace function public.delete_group_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_messages;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select * into v_row from public.group_messages where id = p_message_id;
  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_MESSAGE_NOT_FOUND';
  end if;

  if not private.is_group_member(v_row.group_id) then
    raise exception using
      errcode = '42501',
      message = 'GROUP_ACCESS_DENIED';
  end if;

  if v_row.sender_user_id is distinct from v_uid then
    raise exception using
      errcode = '42501',
      message = 'GROUP_MESSAGE_FORBIDDEN';
  end if;

  if v_row.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'GROUP_MESSAGE_DELETED';
  end if;

  update public.group_messages
  set deleted_at = pg_catalog.now(),
      body = ''
  where id = p_message_id
    and sender_user_id = v_uid
    and deleted_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GROUP_MESSAGE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'group_id', v_row.group_id,
    'sender_user_id', v_row.sender_user_id,
    'body', '',
    'created_at', v_row.created_at,
    'edited_at', v_row.edited_at,
    'deleted_at', v_row.deleted_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.search_users_for_friendship(text) from public;
revoke all on function public.search_users_for_friendship(text) from anon;
grant execute on function public.search_users_for_friendship(text) to authenticated;

revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.send_friend_request(uuid) from anon;
grant execute on function public.send_friend_request(uuid) to authenticated;

revoke all on function public.accept_friend_request(uuid) from public;
revoke all on function public.accept_friend_request(uuid) from anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

revoke all on function public.reject_friend_request(uuid) from public;
revoke all on function public.reject_friend_request(uuid) from anon;
grant execute on function public.reject_friend_request(uuid) to authenticated;

revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

revoke all on function public.remove_friendship(uuid) from public;
revoke all on function public.remove_friendship(uuid) from anon;
grant execute on function public.remove_friendship(uuid) to authenticated;

revoke all on function public.list_my_friends() from public;
revoke all on function public.list_my_friends() from anon;
grant execute on function public.list_my_friends() to authenticated;

revoke all on function public.list_my_friend_requests() from public;
revoke all on function public.list_my_friend_requests() from anon;
grant execute on function public.list_my_friend_requests() to authenticated;

revoke all on function public.update_my_social_profile(text, text, text) from public;
revoke all on function public.update_my_social_profile(text, text, text) from anon;
grant execute on function public.update_my_social_profile(text, text, text) to authenticated;

revoke all on function public.get_my_social_profile() from public;
revoke all on function public.get_my_social_profile() from anon;
grant execute on function public.get_my_social_profile() to authenticated;

revoke all on function public.get_social_player_profile(uuid) from public;
revoke all on function public.get_social_player_profile(uuid) from anon;
grant execute on function public.get_social_player_profile(uuid) to authenticated;

revoke all on function public.get_global_performance_matches() from public;
revoke all on function public.get_global_performance_matches() from anon;
grant execute on function public.get_global_performance_matches() to authenticated;

revoke all on function public.send_group_message(uuid, text) from public;
revoke all on function public.send_group_message(uuid, text) from anon;
grant execute on function public.send_group_message(uuid, text) to authenticated;

revoke all on function public.edit_group_message(uuid, text) from public;
revoke all on function public.edit_group_message(uuid, text) from anon;
grant execute on function public.edit_group_message(uuid, text) to authenticated;

revoke all on function public.delete_group_message(uuid) from public;
revoke all on function public.delete_group_message(uuid) from anon;
grant execute on function public.delete_group_message(uuid) to authenticated;

revoke all on function private.protect_profile_social() from public;
revoke all on function private.protect_profile_social() from anon;
revoke all on function private.protect_profile_social() from authenticated;
revoke all on function private.protect_group_message() from public;
revoke all on function private.protect_group_message() from anon;
revoke all on function private.protect_group_message() from authenticated;

-- Grants finais de tabela:
-- public.profiles: SELECT (id, display_name, username, avatar_path) para authenticated.
--   Sem SELECT/UPDATE de tabela inteira. RPC security definer lê a linha completa.
-- public.group_messages: SELECT para authenticated (Realtime). INSERT/UPDATE/DELETE revogados;
--   escrita só por send/edit/delete_group_message.
