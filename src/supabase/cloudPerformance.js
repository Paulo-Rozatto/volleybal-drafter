import {
  MATCH_SOURCE_SESSION,
  createAnalyzableMatch,
} from '../domain/performanceMatches.js';
import { buildPlayerPerformanceIndexFromMatches } from '../domain/playerPerformance.js';

function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function compareSessionRecency(left, right) {
  const byDate = compareText(left.session_date, right.session_date);
  if (byDate !== 0) return byDate;
  const byUpdated = compareText(left.session_updated_at, right.session_updated_at);
  if (byUpdated !== 0) return byUpdated;
  const byCreated = compareText(left.session_created_at, right.session_created_at);
  if (byCreated !== 0) return byCreated;
  return compareText(left.session_id, right.session_id);
}

function compareRoundRecency(left, right) {
  const byCycle = Number(left.cycle_number ?? 1) - Number(right.cycle_number ?? 1);
  if (byCycle !== 0) return byCycle;
  const byNumber = Number(left.round_number ?? 0) - Number(right.round_number ?? 0);
  if (byNumber !== 0) return byNumber;
  return compareText(left.round_id, right.round_id);
}

function uniqueBy(items, keyOf) {
  const seen = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function roundKey(sessionId, roundId) {
  return `${sessionId}\0${roundId}`;
}

export function assignCloudPerformanceRecency(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sessions = uniqueBy(list, (row) => row.session_id).sort(compareSessionRecency);
  const sourceIndexBySession = new Map(
    sessions.map((session, index) => [session.session_id, index])
  );

  const roundIndexByKey = new Map();
  for (const session of sessions) {
    const rounds = uniqueBy(
      list.filter((row) => row.session_id === session.session_id),
      (row) => row.round_id
    ).sort(compareRoundRecency);
    rounds.forEach((round, index) => {
      roundIndexByKey.set(roundKey(session.session_id, round.round_id), index);
    });
  }

  const matchIndexById = new Map();
  for (const session of sessions) {
    const roundIds = uniqueBy(
      list.filter((row) => row.session_id === session.session_id),
      (row) => row.round_id
    ).map((row) => row.round_id);
    for (const roundId of roundIds) {
      const matches = list
        .filter((row) => row.session_id === session.session_id && row.round_id === roundId)
        .sort((left, right) => compareText(left.match_id, right.match_id));
      matches.forEach((match, index) => {
        matchIndexById.set(match.match_id, index);
      });
    }
  }

  return list.map((row) => ({
    ...row,
    sourceIndex: sourceIndexBySession.get(row.session_id) ?? 0,
    roundIndex: roundIndexByKey.get(roundKey(row.session_id, row.round_id)) ?? 0,
    matchIndex: matchIndexById.get(row.match_id) ?? 0,
  }));
}

function mapLineup(side) {
  return (Array.isArray(side) ? side : []).map((member) => ({
    playerId: member.player_id,
    playerName: member.player_name_snapshot,
  }));
}

export function mapCloudPerformanceMatches(rows) {
  return assignCloudPerformanceRecency(rows).map((row) =>
    createAnalyzableMatch({
      sourceType: MATCH_SOURCE_SESSION,
      sourceId: row.session_id ?? null,
      sourceName: row.session_name,
      date: row.session_date ?? null,
      sourceUpdatedAt: row.session_updated_at,
      sourceCreatedAt: row.session_created_at,
      sourceIndex: row.sourceIndex,
      matchId: row.match_id ?? null,
      roundId: row.round_id ?? null,
      roundNumber: row.round_number,
      roundIndex: row.roundIndex,
      matchIndex: row.matchIndex,
      cycleNumber: row.cycle_number ?? null,
      lineupA: mapLineup(row.lineup_a),
      lineupB: mapLineup(row.lineup_b),
      scoreA: row.score_a ?? null,
      scoreB: row.score_b ?? null,
      originKey: row.legacy_source_id ?? row.session_id ?? null,
    })
  );
}

export function buildCloudPlayerPerformanceIndex(payload) {
  const player = payload?.player ?? null;
  const matches = mapCloudPerformanceMatches(payload?.matches ?? []);
  const roster = player?.id ? [{ id: player.id, name: player.name }] : [];
  return {
    player,
    built: buildPlayerPerformanceIndexFromMatches({ matches, roster }),
  };
}
