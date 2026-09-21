-- Prelude for PGlite / isolated Postgres tests (not applied on hosted Supabase).

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
end;
$roles$;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

grant usage on schema auth to authenticated;
grant usage on schema auth to anon;
grant execute on function auth.uid() to postgres;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.uid() to anon;
