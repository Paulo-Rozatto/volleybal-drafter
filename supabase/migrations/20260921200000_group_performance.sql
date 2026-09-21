-- Group performance read model (etapa 5).
-- Ranking is computed in JS. This RPC only returns sanitized match + member rows.
-- group_members != session_members != session_players: membership is not session access.

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
          left join public.match_players mp on mp.match_id = m.id
          where s.group_id = p_group_id
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

revoke all on function public.get_group_performance_matches(uuid) from public;
revoke all on function public.get_group_performance_matches(uuid) from anon;
grant execute on function public.get_group_performance_matches(uuid) to authenticated;
