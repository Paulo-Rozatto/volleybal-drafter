import { buildPlayerPerformanceIndexFromMatches, getPlayerPerformanceRanking } from '../domain/playerPerformance.js';
import { rpcOk } from './client.js';
import { mapGlobalPerformancePayload } from './mappers.js';

export async function fetchGlobalPerformanceMatches() {
  const result = await rpcOk('get_global_performance_matches');
  if (!result.ok) return { ...result, payload: null };
  return { ok: true, payload: result.data };
}

export async function loadGlobalPerformance() {
  const fetched = await fetchGlobalPerformanceMatches();
  if (!fetched.ok) {
    return { ...fetched, players: [], matches: [], built: null, ranked: [] };
  }
  return buildGlobalPerformance(fetched.payload);
}

export function buildGlobalPerformance(payload) {
  const mapped = mapGlobalPerformancePayload(payload);
  const roster = mapped.players.map((player) => ({
    id: player.playerId,
    name: player.playerName || player.displayName || player.username,
  }));
  const built = buildPlayerPerformanceIndexFromMatches({
    matches: mapped.matches,
    roster,
  });
  const ranked = built.ok
    ? getPlayerPerformanceRanking(built.index, {
        playerIds: mapped.players.map((player) => player.playerId),
        sortBy: 'wins',
      })
        .filter((row) => row.matches > 0)
        .map((row, index) => {
          const social = mapped.players.find((player) => player.playerId === row.playerId);
          return {
            ...row,
            position: index + 1,
            userId: social?.userId ?? null,
            username: social?.username ?? '',
            displayName: social?.displayName ?? row.playerName,
            avatarPath: social?.avatarPath ?? null,
          };
        })
    : [];

  return {
    ok: true,
    players: mapped.players,
    matches: mapped.matches,
    built,
    ranked,
    payload: payload ?? null,
  };
}

export function splitGlobalLeaderboard(model, { lineupSize = null } = {}) {
  if (!model?.built?.ok) {
    return { ranked: [], withoutMatches: model?.players ?? [] };
  }
  const rows = getPlayerPerformanceRanking(model.built.index, {
    playerIds: (model.players ?? []).map((player) => player.playerId),
    sortBy: 'wins',
    lineupSize,
  });
  const ranked = rows
    .filter((row) => row.matches > 0)
    .map((row, index) => {
      const social = (model.players ?? []).find((player) => player.playerId === row.playerId);
      return {
        ...row,
        position: index + 1,
        userId: social?.userId ?? null,
        username: social?.username ?? '',
        displayName: social?.displayName ?? row.playerName,
        avatarPath: social?.avatarPath ?? null,
      };
    });
  const rankedIds = new Set(ranked.map((row) => row.playerId));
  const withoutMatches = (model.players ?? []).filter((player) => !rankedIds.has(player.playerId));
  return { ranked, withoutMatches };
}
