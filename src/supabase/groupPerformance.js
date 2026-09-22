import { mapCloudPerformanceMatches } from './cloudPerformance.js';
import {
  buildPlayerPerformanceIndexFromMatches,
  getPlayerPerformanceRanking,
} from '../domain/playerPerformance.js';

export function mapGroupPerformanceMembers(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? '',
    username: row.username ?? '',
    avatarPath: row.avatar_path ?? null,
    role: row.role,
    playerId: row.player_id ?? null,
    playerName: row.player_name ?? null,
  }));
}

export function buildGroupPerformanceIndex(payload) {
  const members = mapGroupPerformanceMembers(payload?.members ?? []);
  const matches = mapCloudPerformanceMatches(payload?.matches ?? []);
  const roster = members
    .filter((member) => member.playerId)
    .map((member) => ({ id: member.playerId, name: member.playerName ?? member.displayName }));

  return {
    groupId: payload?.group_id ?? null,
    members,
    matches,
    built: buildPlayerPerformanceIndexFromMatches({ matches, roster }),
  };
}

export function splitGroupLeaderboard(built, members, { lineupSize = null } = {}) {
  const list = Array.isArray(members) ? members : [];
  const linked = list.filter((member) => member.playerId);
  const unlinked = list.filter((member) => !member.playerId);

  if (!built?.ok) {
    return { ranked: [], withoutMatches: linked, unlinked };
  }

  const rows = getPlayerPerformanceRanking(built.index, {
    playerIds: linked.map((member) => member.playerId),
    sortBy: 'wins',
    lineupSize,
  });
  const ranked = rows.filter((row) => row.matches > 0).map((row, index) => ({
    ...row,
    position: index + 1,
  }));
  const rankedIds = new Set(ranked.map((row) => row.playerId));
  const withoutMatches = linked.filter((member) => !rankedIds.has(member.playerId));

  return { ranked, withoutMatches, unlinked };
}
