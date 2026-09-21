import { parseScoreConflictDetail } from './cloudSessionDocument.js';
import { getSupabaseClient } from './client.js';
import { messageForCloudError, rpcErrorCode } from './errors.js';
import { normalizeJoinCode } from './joinCode.js';
import { attachMatchPlayersToMatches, mapCloudSession, mapMatch } from './mappers.js';

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
  if (!supabase) return { supabase: null, error: fail({ code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' }) };
  return { supabase, error: null };
}

export async function listCloudSessions() {
  const { supabase, error } = requireClient();
  if (error) return { ...error, sessions: [] };

  const { data, error: queryError } = await supabase
    .from('sessions')
    .select('id, name, date, status, join_code, team_size, team_count, structure_version, group_id, created_at, updated_at')
    .order('date', { ascending: false });

  if (queryError) return { ...fail(queryError), sessions: [] };
  return { ok: true, sessions: data ?? [] };
}

export async function loadCloudSession(sessionId, myUserId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, session: null };

  try {
    const [
      sessionResult,
      membersResult,
      teamsResult,
      roundsResult,
      matchesResult,
      matchPlayersResult,
      playersResult,
      eventsResult,
    ] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle(),
      supabase
        .from('session_members')
        .select('session_id, user_id, role, profiles(id, display_name)')
        .eq('session_id', sessionId),
      supabase
        .from('teams')
        .select('id, session_id, name, sort_index, team_members(player_id, player_name_snapshot)')
        .eq('session_id', sessionId)
        .order('sort_index'),
      supabase
        .from('rounds')
        .select('*')
        .eq('session_id', sessionId)
        .order('cycle_number', { ascending: true })
        .order('number', { ascending: true }),
      supabase.from('matches').select('*').eq('session_id', sessionId),
      // matches has two FKs to match_players (match_id and match_players_session_fk).
      // PostgREST cannot embed that relation; load lineups in one session-scoped query.
      supabase
        .from('match_players')
        .select('match_id, player_id, player_name_snapshot, side, sort_index')
        .eq('session_id', sessionId),
      supabase
        .from('session_players')
        .select('session_id, player_id, player_name_snapshot, players(id, name, skill_score, gender, height, linked_user_id, created_by, archived_at)')
        .eq('session_id', sessionId),
      supabase
        .from('match_events')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false }),
    ]);

    const firstError =
      sessionResult.error ||
      membersResult.error ||
      teamsResult.error ||
      roundsResult.error ||
      matchesResult.error ||
      matchPlayersResult.error ||
      playersResult.error ||
      eventsResult.error;
    if (firstError) return { ...fail(firstError), session: null };
    if (!sessionResult.data) {
      return { ...fail({ code: 'SESSION_NOT_FOUND', message: 'Encontro não encontrado.' }), session: null };
    }

    return {
      ok: true,
      session: mapCloudSession({
        session: sessionResult.data,
        members: membersResult.data ?? [],
        teams: teamsResult.data ?? [],
        rounds: roundsResult.data ?? [],
        matches: attachMatchPlayersToMatches(matchesResult.data ?? [], matchPlayersResult.data ?? []),
        sessionPlayers: playersResult.data ?? [],
        matchEvents: eventsResult.data ?? [],
        myUserId,
      }),
    };
  } catch (caught) {
    return { ...fail(caught), session: null };
  }
}

export async function createCloudSession({ date, name, teamSize, teamCount, createdBy, groupId = null }) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, session: null };

  const { data, error: insertError } = await supabase
    .from('sessions')
    .insert({
      created_by: createdBy,
      date,
      name: name?.trim() ? name.trim() : null,
      team_size: Number(teamSize),
      team_count: Number(teamCount),
      status: 'draft',
      group_id: groupId || null,
    })
    .select('*')
    .single();

  if (insertError) return { ...fail(insertError), session: null };
  return { ok: true, session: data };
}

export async function joinCloudSessionByCode(joinCode) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, sessionId: null };

  const { data, error: rpcError } = await supabase.rpc('join_session_by_code', {
    p_join_code: normalizeJoinCode(joinCode),
  });

  if (rpcError) return { ...fail(rpcError), sessionId: null };
  return { ok: true, sessionId: data };
}

export async function rotateCloudJoinCode(sessionId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, joinCode: null };

  const { data, error: rpcError } = await supabase.rpc('rotate_session_join_code', {
    p_session_id: sessionId,
  });

  if (rpcError) return { ...fail(rpcError), joinCode: null };
  return { ok: true, joinCode: data };
}

export async function setCloudMatchScore(matchId, scoreA, scoreB, expectedVersion) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, match: null };

  const { data, error: rpcError } = await supabase.rpc('set_match_score', {
    p_match_id: matchId,
    p_score_a: scoreA,
    p_score_b: scoreB,
    p_expected_version: expectedVersion,
  });

  if (rpcError) {
    const code = rpcErrorCode(rpcError) ?? 'CLOUD_ERROR';
    return {
      ok: false,
      match: null,
      conflict: code === 'SCORE_VERSION_CONFLICT' ? parseScoreConflictDetail(rpcError) : null,
      errors: [{ code, message: messageForCloudError(rpcError) }],
      error: fail(rpcError).error,
    };
  }

  return { ok: true, match: mapMatch(data), errors: [] };
}

export async function createCloudPlayer({ name, createdBy, skillScore = 3, gender = 'F', height = 'short' }) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, player: null };

  const { data, error: insertError } = await supabase
    .from('players')
    .insert({
      name: String(name ?? '').trim(),
      created_by: createdBy,
      skill_score: skillScore,
      gender,
      height,
    })
    .select('*')
    .single();

  if (insertError) return { ...fail(insertError), player: null };
  return { ok: true, player: data };
}

export async function rpcOk(name, params = {}) {
  const { supabase, error } = requireClient();
  if (error) return error;
  const { data, error: rpcError } = await supabase.rpc(name, params);
  if (rpcError) return fail(rpcError);
  return { ok: true, data };
}

export async function linkCloudPlayer(playerId) {
  const result = await rpcOk('link_player', { p_player_id: playerId });
  if (!result.ok) return { ...result, player: null };
  return { ok: true, player: result.data };
}

export async function listLinkablePlayers(userId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, players: [] };
  const { data, error: queryError } = await supabase
    .from('players')
    .select('*')
    .eq('created_by', userId)
    .is('archived_at', null)
    .order('name');
  if (queryError) return { ...fail(queryError), players: [] };
  return { ok: true, players: data ?? [] };
}

export async function addCloudSessionPlayer(sessionId, playerId, playerName, expectedStructureVersion) {
  return rpcOk('add_session_player', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_player_name_snapshot: playerName,
    p_expected_structure_version: expectedStructureVersion,
  });
}

export async function removeCloudSessionPlayer(sessionId, playerId, expectedStructureVersion) {
  return rpcOk('remove_session_player', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_expected_structure_version: expectedStructureVersion,
  });
}

export async function replaceCloudSessionTeams(sessionId, teamsPlan, expectedStructureVersion) {
  return rpcOk('replace_session_teams', {
    p_session_id: sessionId,
    p_expected_structure_version: expectedStructureVersion,
    p_teams: teamsPlan,
  });
}

export async function applyCloudSessionRounds(
  sessionId,
  mode,
  roundsPlan,
  expectedStructureVersion,
  courtCount = null
) {
  return rpcOk('apply_session_rounds', {
    p_session_id: sessionId,
    p_expected_structure_version: expectedStructureVersion,
    p_mode: mode,
    p_rounds: roundsPlan,
    p_court_count: courtCount,
  });
}

export async function resetCloudSessionToDraft(sessionId, expectedStructureVersion) {
  return rpcOk('reset_session_to_draft', {
    p_session_id: sessionId,
    p_expected_structure_version: expectedStructureVersion,
  });
}

export async function setCloudMatchLineups(matchId, lineupA, lineupB, expectedStructureVersion) {
  return rpcOk('set_match_lineups', {
    p_match_id: matchId,
    p_expected_structure_version: expectedStructureVersion,
    p_lineup_a: lineupA,
    p_lineup_b: lineupB,
  });
}

export async function finalizeCloudSession(sessionId, expectedStructureVersion) {
  return rpcOk('finalize_session', {
    p_session_id: sessionId,
    p_expected_structure_version: expectedStructureVersion,
  });
}

export async function createAndLinkCloudPlayer(name) {
  const result = await rpcOk('create_and_link_player', { p_name: name ?? null });
  if (!result.ok) return { ...result, player: null };
  return { ok: true, player: result.data };
}

export async function requestCloudPlayerLinkClaim(playerId) {
  const result = await rpcOk('request_player_link_claim', { p_player_id: playerId });
  if (!result.ok) return { ...result, claim: null };
  return { ok: true, claim: result.data };
}

export async function approveCloudPlayerLinkClaim(claimId) {
  const result = await rpcOk('approve_player_link_claim', { p_claim_id: claimId });
  if (!result.ok) return { ...result, claim: null };
  return { ok: true, claim: result.data };
}

export async function rejectCloudPlayerLinkClaim(claimId) {
  const result = await rpcOk('reject_player_link_claim', { p_claim_id: claimId });
  if (!result.ok) return { ...result, claim: null };
  return { ok: true, claim: result.data };
}

export async function listClaimableCloudPlayers() {
  const result = await rpcOk('list_claimable_players');
  if (!result.ok) return { ...result, players: [] };
  return { ok: true, players: result.data ?? [] };
}

export async function listMyCloudPlayerLinkClaims() {
  const result = await rpcOk('list_my_player_link_claims');
  if (!result.ok) return { ...result, mine: [], inbox: [] };
  return {
    ok: true,
    mine: result.data?.mine ?? [],
    inbox: result.data?.inbox ?? [],
  };
}

export async function getMyCloudPerformanceMatches() {
  const result = await rpcOk('get_my_performance_matches');
  if (!result.ok) return { ...result, payload: null };
  return { ok: true, payload: result.data };
}

export async function archiveCloudPlayer(playerId) {
  const { supabase, error } = requireClient();
  if (error) return error;

  const { error: updateError } = await supabase
    .from('players')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', playerId);

  if (updateError) return fail(updateError);
  return { ok: true };
}
