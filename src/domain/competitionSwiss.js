import { isMatchCompleted } from './sessionValidation.js';
import {
  cloneCompetitionRound,
  emptyMatch,
  error,
  fail,
  ok,
  pairKey,
  resolveIdGenerator,
} from './competitionPrimitives.js';

/**
 * Buchholz suíço:
 * soma das vitórias atuais (partidas vencidas + BYEs de classificação) de cada
 * adversário efetivamente enfrentado. BYE não entra como adversário fictício.
 * As vitórias do adversário são as finais/atuais da fase, não as do momento do jogo.
 */

export function swissPlayedPairKeys(stage) {
  const keys = new Set();
  for (const round of stage?.rounds ?? []) {
    for (const match of round?.matches ?? []) {
      if (match?.teamAId && match?.teamBId) keys.add(pairKey(match.teamAId, match.teamBId));
    }
  }
  return keys;
}

export function swissByeHistory(stage) {
  const counts = new Map();
  for (const round of stage?.rounds ?? []) {
    for (const bye of round?.byes ?? []) {
      if (typeof bye?.teamId === 'string' && bye.teamId) {
        counts.set(bye.teamId, (counts.get(bye.teamId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function isSwissRoundComplete(round) {
  const matches = round?.matches ?? [];
  if (matches.length === 0 && (round?.byes ?? []).length === 0) return false;
  return matches.every((match) => isMatchCompleted(match));
}

export function seedIndexByTeamId(seedTeamIds) {
  const map = new Map();
  (seedTeamIds ?? []).forEach((teamId, index) => {
    map.set(teamId, index + 1);
  });
  return map;
}

function emptyStanding(teamId, seed) {
  return {
    teamId,
    played: 0,
    wins: 0,
    losses: 0,
    byes: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifference: 0,
    buchholz: 0,
    initialSeed: seed,
  };
}

export function getSwissStandings(stage, teamIds) {
  const seeds = seedIndexByTeamId(stage?.seedTeamIds ?? teamIds);
  const ids = teamIds ?? stage?.seedTeamIds ?? [];
  const rows = new Map(ids.map((teamId) => [teamId, emptyStanding(teamId, seeds.get(teamId) ?? Number.MAX_SAFE_INTEGER)]));
  const opponents = new Map(ids.map((teamId) => [teamId, []]));

  for (const round of stage?.rounds ?? []) {
    for (const bye of round?.byes ?? []) {
      const row = rows.get(bye.teamId);
      if (!row) continue;
      row.byes += 1;
      row.wins += 1;
    }
    for (const match of round?.matches ?? []) {
      if (!isMatchCompleted(match) || !match.teamAId || !match.teamBId) continue;
      const sideA = rows.get(match.teamAId);
      const sideB = rows.get(match.teamBId);
      if (!sideA || !sideB) continue;
      sideA.played += 1;
      sideB.played += 1;
      sideA.pointsFor += match.scoreA;
      sideA.pointsAgainst += match.scoreB;
      sideB.pointsFor += match.scoreB;
      sideB.pointsAgainst += match.scoreA;
      if (match.scoreA > match.scoreB) {
        sideA.wins += 1;
        sideB.losses += 1;
      } else {
        sideB.wins += 1;
        sideA.losses += 1;
      }
      opponents.get(match.teamAId).push(match.teamBId);
      opponents.get(match.teamBId).push(match.teamAId);
    }
  }

  for (const row of rows.values()) {
    row.pointDifference = row.pointsFor - row.pointsAgainst;
    row.buchholz = (opponents.get(row.teamId) ?? []).reduce((sum, opponentId) => {
      return sum + (rows.get(opponentId)?.wins ?? 0);
    }, 0);
  }

  const standings = [...rows.values()];
  standings.sort(compareSwissStandings);
  return standings.map((row) => ({ ...row }));
}

export function compareSwissStandings(left, right) {
  if (right.wins !== left.wins) return right.wins - left.wins;
  if (right.buchholz !== left.buchholz) return right.buchholz - left.buchholz;
  if (right.pointDifference !== left.pointDifference) return right.pointDifference - left.pointDifference;
  if (right.pointsFor !== left.pointsFor) return right.pointsFor - left.pointsFor;
  if (left.initialSeed !== right.initialSeed) return left.initialSeed - right.initialSeed;
  return String(left.teamId).localeCompare(String(right.teamId));
}

export function freezeSwissSeedSnapshot(standings) {
  return (standings ?? []).map((row, index) => ({
    seed: index + 1,
    teamId: row.teamId,
    wins: row.wins,
    losses: row.losses,
    buchholz: row.buchholz,
    pointDifference: row.pointDifference,
  }));
}

export function selectSwissBye(standings, byeCounts) {
  if (!Array.isArray(standings) || standings.length % 2 === 0) return null;
  const ranked = [...standings].reverse();
  const unused = ranked.filter((row) => (byeCounts.get(row.teamId) ?? 0) === 0);
  const pool = unused.length > 0 ? unused : ranked;
  return pool[0]?.teamId ?? null;
}

function candidateOpponents(teamIds, used, index, standingsById, playedKeys) {
  const id = teamIds[index];
  const wins = standingsById.get(id)?.wins ?? 0;
  const list = [];
  for (let otherIndex = index + 1; otherIndex < teamIds.length; otherIndex += 1) {
    if (used[otherIndex]) continue;
    const otherId = teamIds[otherIndex];
    list.push({
      otherIndex,
      otherId,
      rematch: playedKeys.has(pairKey(id, otherId)) ? 1 : 0,
      winDiff: Math.abs(wins - (standingsById.get(otherId)?.wins ?? 0)),
    });
  }
  list.sort((left, right) => {
    if (left.rematch !== right.rematch) return left.rematch - right.rematch;
    if (left.winDiff !== right.winDiff) return left.winDiff - right.winDiff;
    if (left.otherIndex !== right.otherIndex) return left.otherIndex - right.otherIndex;
    return String(left.otherId).localeCompare(String(right.otherId));
  });
  return list;
}

export function pairSwissTeams(teamIds, standingsById, playedKeys) {
  const n = teamIds.length;
  const used = new Array(n).fill(false);
  let best = null;
  let bestRematches = Infinity;

  function dfs(start, rematches, pairs) {
    if (rematches >= bestRematches) return;
    let index = start;
    while (index < n && used[index]) index += 1;
    if (index >= n) {
      bestRematches = rematches;
      best = pairs.map((pair) => pair.slice());
      return;
    }
    used[index] = true;
    for (const candidate of candidateOpponents(teamIds, used, index, standingsById, playedKeys)) {
      used[candidate.otherIndex] = true;
      pairs.push([teamIds[index], candidate.otherId]);
      dfs(index + 1, rematches + candidate.rematch, pairs);
      pairs.pop();
      used[candidate.otherIndex] = false;
      if (bestRematches === 0) break;
    }
    used[index] = false;
  }

  dfs(0, 0, []);
  return best;
}

export function pairFirstSwissRound(seedTeamIds) {
  const ids = [...(seedTeamIds ?? [])];
  const byeTeamId = ids.length % 2 === 1 ? ids[ids.length - 1] : null;
  const playing = byeTeamId ? ids.slice(0, -1) : ids;
  const pairs = [];
  for (let index = 0; index < playing.length; index += 2) {
    pairs.push([playing[index], playing[index + 1]]);
  }
  return { pairs, byeTeamId };
}

function buildSwissRound({ number, pairs, byeTeamId, idGenerator }) {
  const createId = resolveIdGenerator(idGenerator);
  const roundId = createId();
  return {
    id: roundId,
    number,
    name: `Rodada ${number}`,
    bracket: 'swiss',
    matches: pairs.map(([teamAId, teamBId]) =>
      emptyMatch(createId(), roundId, { type: 'team', teamId: teamAId }, { type: 'team', teamId: teamBId })
    ),
    byes: byeTeamId ? [{ teamId: byeTeamId }] : [],
  };
}

export function createFirstSwissRound(seedTeamIds, { idGenerator } = {}) {
  const { pairs, byeTeamId } = pairFirstSwissRound(seedTeamIds);
  return buildSwissRound({ number: 1, pairs, byeTeamId, idGenerator });
}

export function createNextSwissRound(stage, teamIds, { idGenerator } = {}) {
  const standings = getSwissStandings(stage, teamIds);
  const byeCounts = swissByeHistory(stage);
  const byeTeamId = selectSwissBye(standings, byeCounts);
  const remaining = standings
    .map((row) => row.teamId)
    .filter((teamId) => teamId !== byeTeamId);
  const standingsById = new Map(standings.map((row) => [row.teamId, row]));
  const pairs = pairSwissTeams(remaining, standingsById, swissPlayedPairKeys(stage));
  if (!pairs || pairs.length * 2 !== remaining.length) {
    return fail([error('SWISS_PAIRING_FAILED', 'Não foi possível gerar o pareamento suíço.')]);
  }
  const number = (stage.rounds ?? []).length + 1;
  return {
    ok: true,
    errors: [],
    round: cloneCompetitionRound(buildSwissRound({ number, pairs, byeTeamId, idGenerator })),
  };
}

export function assertSwissRoundCompleteForNext(stage) {
  const rounds = stage?.rounds ?? [];
  if (rounds.length === 0) return ok();
  const current = rounds[rounds.length - 1];
  if (!isSwissRoundComplete(current)) {
    return fail([
      error(
        'SWISS_ROUND_INCOMPLETE',
        'Conclua todas as partidas da rodada atual antes de gerar a próxima.'
      ),
    ]);
  }
  return ok();
}
