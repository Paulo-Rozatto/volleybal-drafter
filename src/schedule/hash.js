const GROUP_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SCHEDULE_HASH = new RegExp(`^#/group/(${GROUP_UUID})/schedule$`, 'i');
const PROPOSAL_HASH = new RegExp(`^#/group/(${GROUP_UUID})/proposal/(${GROUP_UUID})$`, 'i');

export function groupScheduleHash(groupId) {
  return `#/group/${groupId}/schedule`;
}

export function groupProposalHash(groupId, proposalId) {
  return `#/group/${groupId}/proposal/${proposalId}`;
}

export function parseGroupScheduleHash(hash) {
  const value = String(hash ?? '');
  const proposal = value.match(PROPOSAL_HASH);
  if (proposal) {
    return { groupId: proposal[1], section: 'disponibilidade', proposalId: proposal[2] };
  }
  const schedule = value.match(SCHEDULE_HASH);
  if (schedule) {
    return { groupId: schedule[1], section: 'disponibilidade', proposalId: null };
  }
  return null;
}
