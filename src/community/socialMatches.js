import {
  MATCH_SOURCE_COMPETITION,
  MATCH_SOURCE_SESSION,
  createAnalyzableMatch,
} from '../domain/performanceMatches.js';
import { buildPlayerPerformanceIndexFromMatches } from '../domain/playerPerformance.js';

function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function uniqueBy(items, keyOf) {
  const seen = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function socialSourceKey(row) {
  return row?.source_token ?? '';
}

function socialRoundKey(row) {
  return `${socialSourceKey(row)}\0${row?.round_token ?? ''}`;
}

function compareSocialSourceRecency(left, right) {
  const byDate = compareText(left.date, right.date);
  if (byDate !== 0) return byDate;
  return compareText(left.source_token, right.source_token);
}

function compareSocialRoundRecency(left, right) {
  const byCycle = Number(left.cycle_number ?? 1) - Number(right.cycle_number ?? 1);
  if (byCycle !== 0) return byCycle;
  const byNumber = Number(left.round_number ?? 0) - Number(right.round_number ?? 0);
  if (byNumber !== 0) return byNumber;
  return compareText(left.round_token, right.round_token);
}

export function assignSocialPerformanceRecency(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sources = uniqueBy(list, socialSourceKey).sort(compareSocialSourceRecency);
  const sourceIndexByKey = new Map(sources.map((source, index) => [socialSourceKey(source), index]));

  const roundIndexByKey = new Map();
  for (const source of sources) {
    const key = socialSourceKey(source);
    const rounds = uniqueBy(
      list.filter((row) => socialSourceKey(row) === key),
      (row) => row.round_token
    ).sort(compareSocialRoundRecency);
    rounds.forEach((round, index) => {
      roundIndexByKey.set(socialRoundKey(round), index);
    });
  }

  const matchIndexById = new Map();
  for (const source of sources) {
    const key = socialSourceKey(source);
    const roundTokens = uniqueBy(
      list.filter((row) => socialSourceKey(row) === key),
      (row) => row.round_token
    ).map((row) => row.round_token);
    for (const roundToken of roundTokens) {
      const matches = list
        .filter((row) => socialSourceKey(row) === key && row.round_token === roundToken)
        .sort((left, right) => compareText(left.social_match_id, right.social_match_id));
      matches.forEach((match, index) => {
        matchIndexById.set(match.social_match_id, index);
      });
    }
  }

  return list.map((row) => ({
    ...row,
    sourceIndex: sourceIndexByKey.get(socialSourceKey(row)) ?? 0,
    roundIndex: roundIndexByKey.get(socialRoundKey(row)) ?? 0,
    matchIndex: matchIndexById.get(row.social_match_id) ?? 0,
  }));
}

function mapLineup(side) {
  return (Array.isArray(side) ? side : []).map((member) => ({
    playerId: member.player_id,
    playerName: member.player_name_snapshot,
  }));
}

export function mapSocialPerformanceMatches(rows) {
  return assignSocialPerformanceRecency(rows).map((row) => {
    const isCompetition = row.source_kind === 'competition';
    return createAnalyzableMatch({
      sourceType: isCompetition ? MATCH_SOURCE_COMPETITION : MATCH_SOURCE_SESSION,
      sourceId: row.source_token ?? null,
      sourceName: null,
      date: row.date ?? null,
      sourceIndex: row.sourceIndex,
      matchId: row.social_match_id ?? null,
      roundId: row.round_token ?? null,
      roundNumber: row.round_number,
      roundIndex: row.roundIndex,
      matchIndex: row.matchIndex,
      cycleNumber: row.cycle_number ?? null,
      lineupA: mapLineup(row.lineup_a),
      lineupB: mapLineup(row.lineup_b),
      scoreA: row.score_a ?? null,
      scoreB: row.score_b ?? null,
      originKey: row.origin_key ?? row.source_token ?? null,
    });
  });
}

export function buildSocialPlayerPerformanceIndex(payload) {
  const player = payload?.player ?? null;
  const matches = mapSocialPerformanceMatches(payload?.matches ?? []);
  const roster = player?.id ? [{ id: player.id, name: player.name }] : [];
  return {
    player,
    built: buildPlayerPerformanceIndexFromMatches({ matches, roster }),
  };
}

export const SOCIAL_MATCH_PAYLOAD_KEYS = Object.freeze([
  'source_kind',
  'social_match_id',
  'source_token',
  'origin_key',
  'round_token',
  'date',
  'round_number',
  'cycle_number',
  'score_a',
  'score_b',
  'lineup_a',
  'lineup_b',
]);

export const SOCIAL_MATCH_FORBIDDEN_KEYS = Object.freeze([
  'session_id',
  'competition_id',
  'session_name',
  'legacy_source_id',
  'group_id',
  'join_code',
  'joinCode',
  'round_id',
  'match_id',
  'session_updated_at',
  'session_created_at',
  'role',
]);
