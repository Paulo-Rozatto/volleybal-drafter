import { getSupabaseClient } from './client.js';
import { assembleCloudCompetition, mapCompetitionCard } from './competitionMappers.js';
import { messageForCloudError, rpcErrorCode } from './errors.js';
import { normalizeJoinCode } from './joinCode.js';

function fail(error) {
  const code = rpcErrorCode(error) ?? error?.code ?? 'CLOUD_ERROR';
  return {
    ok: false,
    error: {
      code,
      message: messageForCloudError({ ...error, message: error?.message, code }),
    },
  };
}

function requireClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      supabase: null,
      error: fail({ code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' }),
    };
  }
  return { supabase, error: null };
}

async function rpcOk(name, params = {}) {
  const { supabase, error } = requireClient();
  if (error) return error;
  try {
    const { data, error: rpcError } = await supabase.rpc(name, params);
    if (rpcError) return fail(rpcError);
    return { ok: true, data };
  } catch (caught) {
    return fail(caught);
  }
}

export async function listCloudCompetitions() {
  const { supabase, error } = requireClient();
  if (error) return { ...error, competitions: [] };

  try {
    const { data, error: queryError } = await supabase
      .from('competitions')
      .select(
        'id, name, date, status, join_code, format_team_size, structure_version, group_id, created_at, updated_at'
      )
      .order('date', { ascending: false });
    if (queryError) return { ...fail(queryError), competitions: [] };
    return { ok: true, competitions: (data ?? []).map(mapCompetitionCard) };
  } catch (caught) {
    return { ...fail(caught), competitions: [] };
  }
}

export async function listGroupCloudCompetitions(groupId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, competitions: [] };
  if (!groupId) return { ok: true, competitions: [] };

  try {
    const { data, error: queryError } = await supabase
      .from('competitions')
      .select(
        'id, name, date, status, join_code, format_team_size, structure_version, group_id, created_at, updated_at'
      )
      .eq('group_id', groupId)
      .order('date', { ascending: false });
    if (queryError) return { ...fail(queryError), competitions: [] };
    return { ok: true, competitions: (data ?? []).map(mapCompetitionCard) };
  } catch (caught) {
    return { ...fail(caught), competitions: [] };
  }
}

export async function loadCloudCompetition(competitionId, myUserId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, loaded: null };

  try {
    const [
      competitionResult,
      membersResult,
      playersResult,
      teamsResult,
      teamMembersResult,
      stagesResult,
      roundsResult,
      byesResult,
      matchesResult,
      matchPlayersResult,
      eventsResult,
    ] = await Promise.all([
      supabase.from('competitions').select('*').eq('id', competitionId).maybeSingle(),
      supabase
        .from('competition_members')
        .select('competition_id, user_id, role, profiles(id, display_name)')
        .eq('competition_id', competitionId),
      supabase
        .from('competition_players')
        .select('competition_id, player_id, player_name_snapshot, sort_index')
        .eq('competition_id', competitionId)
        .order('sort_index'),
      supabase
        .from('competition_teams')
        .select('id, competition_id, sort_index')
        .eq('competition_id', competitionId)
        .order('sort_index'),
      supabase
        .from('competition_team_members')
        .select('team_id, competition_id, player_id, player_name_snapshot, sort_index')
        .eq('competition_id', competitionId),
      supabase
        .from('competition_stages')
        .select('*')
        .eq('competition_id', competitionId)
        .order('number'),
      supabase.from('competition_rounds').select('*').eq('competition_id', competitionId),
      supabase.from('competition_round_byes').select('*').eq('competition_id', competitionId),
      supabase.from('competition_matches').select('*').eq('competition_id', competitionId),
      supabase
        .from('competition_match_players')
        .select('match_id, competition_id, player_id, player_name_snapshot, side, sort_index')
        .eq('competition_id', competitionId),
      supabase
        .from('competition_match_events')
        .select('*')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false }),
    ]);

    const firstError =
      competitionResult.error ||
      membersResult.error ||
      playersResult.error ||
      teamsResult.error ||
      teamMembersResult.error ||
      stagesResult.error ||
      roundsResult.error ||
      byesResult.error ||
      matchesResult.error ||
      matchPlayersResult.error ||
      eventsResult.error;
    if (firstError) return { ...fail(firstError), loaded: null };
    if (!competitionResult.data) {
      return { ...fail({ code: 'COMPETITION_NOT_FOUND' }), loaded: null };
    }

    return {
      ok: true,
      loaded: assembleCloudCompetition({
        competition: competitionResult.data,
        members: membersResult.data ?? [],
        players: playersResult.data ?? [],
        teams: teamsResult.data ?? [],
        teamMembers: teamMembersResult.data ?? [],
        stages: stagesResult.data ?? [],
        rounds: roundsResult.data ?? [],
        byes: byesResult.data ?? [],
        matches: matchesResult.data ?? [],
        matchPlayers: matchPlayersResult.data ?? [],
        events: eventsResult.data ?? [],
        myUserId,
      }),
    };
  } catch (caught) {
    return { ...fail(caught), loaded: null };
  }
}

export async function createCloudCompetition({
  name,
  date,
  teamSize,
  groupId = null,
  stages = null,
} = {}) {
  const result = await rpcOk('create_competition', {
    p_name: name?.trim() ? name.trim() : null,
    p_date: date,
    p_format_team_size: Number(teamSize),
    p_group_id: groupId || null,
    p_stages: stages,
  });
  if (!result.ok) return { ...result, competitionId: null };
  return { ok: true, competitionId: result.data?.id ?? result.data, competition: result.data };
}

export async function joinCloudCompetitionByCode(joinCode) {
  const result = await rpcOk('join_competition_by_code', {
    p_join_code: normalizeJoinCode(joinCode),
  });
  if (!result.ok) return { ...result, competitionId: null };
  return { ok: true, competitionId: result.data };
}

export async function rotateCloudCompetitionJoinCode(competitionId) {
  const result = await rpcOk('rotate_competition_join_code', { p_competition_id: competitionId });
  if (!result.ok) return { ...result, joinCode: null };
  return { ok: true, joinCode: result.data };
}

export async function replaceCloudCompetitionTeams(competitionId, expectedStructureVersion, teams) {
  const result = await rpcOk('replace_competition_teams', {
    p_competition_id: competitionId,
    p_expected_structure_version: expectedStructureVersion,
    p_teams: teams,
  });
  if (!result.ok) return result;
  return { ok: true, structureVersion: result.data };
}

export async function saveCloudCompetitionStructure(
  competitionId,
  expectedStructureVersion,
  documentCompetition
) {
  const result = await rpcOk('save_competition_structure', {
    p_competition_id: competitionId,
    p_expected_structure_version: expectedStructureVersion,
    p_document: documentCompetition,
  });
  if (!result.ok) return result;
  return { ok: true, structureVersion: result.data };
}

export async function setCloudCompetitionMatchScore({
  competitionId,
  matchId,
  scoreA,
  scoreB,
  playedDate,
  expectedVersion,
  expectedStructureVersion,
  documentCompetition,
}) {
  const result = await rpcOk('set_competition_match_score', {
    p_competition_id: competitionId,
    p_match_id: matchId,
    p_score_a: scoreA,
    p_score_b: scoreB,
    p_played_date: playedDate ?? null,
    p_expected_version: expectedVersion,
    p_expected_structure_version: expectedStructureVersion,
    p_document: documentCompetition,
  });
  if (!result.ok) return { ...result, match: null };
  return { ok: true, match: result.data };
}

export async function finalizeCloudCompetition(competitionId, expectedStructureVersion) {
  const result = await rpcOk('finalize_competition', {
    p_competition_id: competitionId,
    p_expected_structure_version: expectedStructureVersion,
  });
  if (!result.ok) return { ...result, competition: null };
  return { ok: true, competition: result.data };
}

export async function setCloudCompetitionMemberRole(competitionId, userId, role) {
  return rpcOk('set_competition_member_role', {
    p_competition_id: competitionId,
    p_user_id: userId,
    p_role: role,
  });
}

export async function removeCloudCompetitionMember(competitionId, userId) {
  return rpcOk('remove_competition_member', {
    p_competition_id: competitionId,
    p_user_id: userId,
  });
}
