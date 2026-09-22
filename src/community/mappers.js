import { mapSocialPerformanceMatches } from './socialMatches.js';

export const PRIVATE_SOCIAL_KEYS = Object.freeze([
  'email',
  'phone',
  'join_code',
  'joinCode',
  'created_by',
  'createdBy',
  'raw_user_meta_data',
  'auth_id',
  'legacy_import',
  'migration',
]);

export function mapSocialProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id ?? row.id ?? null,
    username: row.username ?? '',
    displayName: row.display_name ?? '',
    avatarPath: row.avatar_path ?? null,
    playerId: row.player_id ?? null,
    playerName: row.player_name ?? null,
    friendshipState: row.friendship_state ?? null,
    requestId: row.id && row.friendship_state ? row.id : row.request_id ?? null,
    createdAt: row.created_at ?? null,
  };
}

export function mapFriendList(rows) {
  return (Array.isArray(rows) ? rows : []).map(mapSocialProfile).filter(Boolean);
}

export function mapGroupMessage(row, profilesByUserId = {}) {
  if (!row) return null;
  const senderUserId = row.sender_user_id ?? row.senderUserId ?? null;
  const profile = profilesByUserId[senderUserId] ?? {};
  const deleted = Boolean(row.deleted_at ?? row.deletedAt);
  return {
    id: row.id,
    groupId: row.group_id ?? row.groupId ?? null,
    senderUserId,
    senderName: profile.displayName || profile.display_name || 'Jogador',
    senderUsername: profile.username ?? '',
    senderAvatarPath: profile.avatarPath ?? profile.avatar_path ?? null,
    body: deleted ? '' : String(row.body ?? ''),
    createdAt: row.created_at ?? row.createdAt ?? null,
    editedAt: row.edited_at ?? row.editedAt ?? null,
    deletedAt: row.deleted_at ?? row.deletedAt ?? null,
    deleted,
  };
}

export function sortGroupMessages(messages) {
  return [...(Array.isArray(messages) ? messages : [])].sort((left, right) => {
    const byTime = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
    if (byTime !== 0) return byTime;
    return String(left.id ?? '').localeCompare(String(right.id ?? ''));
  });
}

export function mergeGroupMessage(list, incoming) {
  if (!incoming?.id) return sortGroupMessages(list);
  const current = Array.isArray(list) ? list : [];
  const index = current.findIndex((item) => item.id === incoming.id);
  if (index === -1) return sortGroupMessages([...current, incoming]);
  const next = [...current];
  next[index] = incoming;
  return sortGroupMessages(next);
}

export function payloadLooksPrivate(value) {
  if (!value || typeof value !== 'object') return false;
  const text = JSON.stringify(value);
  return PRIVATE_SOCIAL_KEYS.some((key) => {
    if (key === 'created_by' || key === 'createdBy') {
      return new RegExp(`"${key}"\\s*:`).test(text);
    }
    return text.includes(`"${key}"`);
  });
}

export function mapGlobalPerformancePayload(payload) {
  const players = (Array.isArray(payload?.players) ? payload.players : []).map((row) => ({
    userId: row.user_id,
    username: row.username ?? '',
    displayName: row.display_name ?? '',
    avatarPath: row.avatar_path ?? null,
    playerId: row.player_id,
    playerName: row.player_name ?? row.display_name ?? '',
  }));
  return {
    players,
    matches: mapSocialPerformanceMatches(payload?.matches ?? []),
    rawMatches: payload?.matches ?? [],
  };
}
