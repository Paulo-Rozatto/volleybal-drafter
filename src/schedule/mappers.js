import { canManageGroup } from '../supabase/groupMappers.js';

export const PROPOSAL_STATUS_LABELS = Object.freeze({
  open: 'Aberta',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
});

export const RSVP_LABELS = Object.freeze({
  yes: 'Vou',
  maybe: 'Talvez',
  no: 'Não vou',
});

export function mapAvailabilityMember(row) {
  if (!row) return null;
  return {
    userId: row.user_id ?? row.userId ?? null,
    username: row.username ?? '',
    displayName: row.display_name ?? row.displayName ?? '',
    avatarPath: row.avatar_path ?? row.avatarPath ?? null,
  };
}

export function mapAvailabilityPayload(payload) {
  return {
    groupId: payload?.group_id ?? null,
    timezone: payload?.timezone ?? 'America/Sao_Paulo',
    members: (Array.isArray(payload?.members) ? payload.members : []).map(mapAvailabilityMember).filter(Boolean),
    slots: (Array.isArray(payload?.slots) ? payload.slots : []).map((row) => ({
      userId: row.user_id,
      slotStart: row.slot_start,
    })),
  };
}

export function mapProposal(row) {
  if (!row) return null;
  const counts = row.counts ?? {};
  return {
    id: row.id,
    groupId: row.group_id,
    createdBy: row.created_by,
    title: row.title ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    locationName: row.location_name ?? null,
    locationDetails: row.location_details ?? null,
    notes: row.notes ?? null,
    status: row.status,
    linkedSessionId: row.linked_session_id ?? null,
    version: Number(row.version ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    creator: mapAvailabilityMember(row.creator),
    counts: {
      yes: Number(counts.yes ?? 0),
      maybe: Number(counts.maybe ?? 0),
      no: Number(counts.no ?? 0),
      unanswered: Number(counts.unanswered ?? 0),
    },
    responses: (Array.isArray(row.responses) ? row.responses : []).map((item) => ({
      ...mapAvailabilityMember(item),
      playerId: item.player_id ?? null,
      playerName: item.player_name ?? null,
      response: item.response,
      updatedAt: item.updated_at,
    })),
  };
}

export function mapProposalsPayload(payload) {
  return {
    groupId: payload?.group_id ?? null,
    timezone: payload?.timezone ?? 'America/Sao_Paulo',
    proposals: (Array.isArray(payload?.proposals) ? payload.proposals : []).map(mapProposal).filter(Boolean),
  };
}

export function canEditProposal(proposal, myUserId, myRole) {
  if (!proposal || proposal.status === 'cancelled') return false;
  return proposal.createdBy === myUserId || canManageGroup(myRole);
}

export function mergeAvailabilitySlots(slots, incoming, eventType) {
  const current = Array.isArray(slots) ? slots : [];
  const userId = incoming?.user_id ?? incoming?.userId;
  const slotStart = incoming?.slot_start ?? incoming?.slotStart;
  if (!userId || !slotStart) return current;
  const without = current.filter((item) => !(item.userId === userId && item.slotStart === slotStart));
  if (eventType === 'DELETE') return without;
  return [...without, { userId, slotStart }];
}

export function mergeProposalList(list, incomingProposal) {
  const mapped = mapProposal(incomingProposal);
  if (!mapped?.id) return Array.isArray(list) ? list : [];
  const current = Array.isArray(list) ? list : [];
  const index = current.findIndex((item) => item.id === mapped.id);
  if (index === -1) {
    return [...current, mapped].sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)));
  }
  const previous = current[index];
  const next = [...current];
  next[index] = {
    ...previous,
    ...mapped,
    creator: mapped.creator || previous.creator,
    responses: mapped.responses?.length ? mapped.responses : previous.responses,
    counts: mapped.counts ?? previous.counts,
  };
  return next;
}
