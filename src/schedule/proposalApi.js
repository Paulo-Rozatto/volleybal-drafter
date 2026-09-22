import { rpcOk } from '../community/client.js';
import { mapProposal, mapProposalsPayload } from './mappers.js';

export async function fetchGroupGameProposals(groupId) {
  const result = await rpcOk('get_group_game_proposals', { p_group_id: groupId });
  if (!result.ok) return { ...result, payload: null };
  return { ok: true, payload: mapProposalsPayload(result.data) };
}

export async function fetchGroupGameProposal(proposalId) {
  const result = await rpcOk('get_group_game_proposal', { p_proposal_id: proposalId });
  if (!result.ok) return { ...result, payload: null };
  return {
    ok: true,
    payload: {
      timezone: result.data?.timezone ?? 'America/Sao_Paulo',
      proposal: mapProposal(result.data?.proposal),
    },
  };
}

export async function createGroupGameProposal(params) {
  const result = await rpcOk('create_group_game_proposal', {
    p_group_id: params.groupId,
    p_title: params.title,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_location_name: params.locationName ?? null,
    p_location_details: params.locationDetails ?? null,
    p_notes: params.notes ?? null,
  });
  if (!result.ok) return { ...result, proposal: null };
  return { ok: true, proposal: mapProposal(result.data) };
}

export async function updateGroupGameProposal(proposalId, expectedVersion, patch) {
  const result = await rpcOk('update_group_game_proposal', {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
    p_title: patch.title ?? null,
    p_starts_at: patch.startsAt ?? null,
    p_ends_at: patch.endsAt ?? null,
    p_location_name: patch.locationName,
    p_location_details: patch.locationDetails,
    p_notes: patch.notes,
  });
  if (!result.ok) return { ...result, proposal: null };
  return { ok: true, proposal: mapProposal(result.data) };
}

export async function cancelGroupGameProposal(proposalId, expectedVersion) {
  const result = await rpcOk('cancel_group_game_proposal', {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
  });
  if (!result.ok) return { ...result, proposal: null };
  return { ok: true, proposal: mapProposal(result.data) };
}

export async function confirmGroupGameProposal(proposalId, expectedVersion) {
  const result = await rpcOk('confirm_group_game_proposal', {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
  });
  if (!result.ok) return { ...result, proposal: null };
  return { ok: true, proposal: mapProposal(result.data) };
}

export async function respondToGroupGameProposal(proposalId, response) {
  const result = await rpcOk('respond_to_group_game_proposal', {
    p_proposal_id: proposalId,
    p_response: response,
  });
  if (!result.ok) return { ...result, proposal: null };
  return { ok: true, proposal: mapProposal(result.data) };
}

export async function createSessionFromGroupProposal(proposalId, expectedVersion, { teamSize = 2, teamCount = 2 } = {}) {
  const result = await rpcOk('create_session_from_group_proposal', {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
    p_team_size: teamSize,
    p_team_count: teamCount,
  });
  if (!result.ok) return { ...result, sessionId: null, proposal: null };
  return {
    ok: true,
    sessionId: result.data?.session_id ?? null,
    alreadyLinked: Boolean(result.data?.already_linked),
    structureVersion: Number(result.data?.structure_version ?? 0),
    proposal: mapProposal(result.data?.proposal),
  };
}
