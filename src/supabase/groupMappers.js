import { translateRole } from '../ui/labels.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asProfile(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function mapGroupMember(row) {
  const profile = asProfile(row?.profiles ?? row?.profile ?? null);
  return {
    userId: row.user_id,
    displayName: profile?.display_name ?? profile?.displayName ?? '',
    username: profile?.username ?? '',
    avatarPath: profile?.avatar_path ?? profile?.avatarPath ?? null,
    role: row.role,
    joinedAt: row.joined_at ?? null,
  };
}

export function mapGroup({ group, members = [], myUserId } = {}) {
  if (!group) return null;

  const mappedMembers = asArray(members)
    .map(mapGroupMember)
    .sort((left, right) => {
      const roleRank = { owner: 0, admin: 1, member: 2 };
      const rankDelta = (roleRank[left.role] ?? 9) - (roleRank[right.role] ?? 9);
      if (rankDelta !== 0) return rankDelta;
      return String(left.displayName).localeCompare(String(right.displayName));
    });
  const myMembership = mappedMembers.find((member) => member.userId === myUserId) ?? null;

  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    joinCode: group.join_code,
    createdBy: group.created_by,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    members: mappedMembers,
    memberCount: mappedMembers.length,
    myRole: myMembership?.role ?? null,
  };
}

export function canManageGroup(role) {
  return role === 'owner' || role === 'admin';
}

export function attachGroupMembers(groups, members, myUserId) {
  const grouped = new Map();
  for (const row of asArray(members)) {
    const groupId = row.group_id;
    if (!groupId) continue;
    const list = grouped.get(groupId);
    if (list) list.push(row);
    else grouped.set(groupId, [row]);
  }

  return asArray(groups).map((group) =>
    mapGroup({
      group,
      members: grouped.get(group.id) ?? [],
      myUserId,
    })
  );
}

export function groupRoleLabel(role) {
  return translateRole(role);
}
