import { cloneTeamMembers } from './teamSession.js';

export const COMPETITION_STATUSES = Object.freeze(['draft', 'in_progress', 'finished']);
export const COMPETITION_STAGE_STATUSES = Object.freeze(['pending', 'in_progress', 'finished']);
export const COMPETITION_STAGE_TYPES = Object.freeze([
  'swiss',
  'double_elimination',
  'single_elimination',
  'round_robin',
  'groups',
]);
export const COMPETITION_SOURCE_TYPES = Object.freeze(['team', 'winner', 'loser', 'seed']);
export const COMPETITION_BRACKETS = Object.freeze([
  'swiss',
  'winners',
  'losers',
  'grand_final',
  'grand_final_reset',
]);
export const COMPETITION_GRAND_FINAL_MODES = Object.freeze(['bracket_reset', 'single_final']);
export const MIN_COMPETITION_TEAM_COUNT = 2;

export function ok() {
  return { ok: true, errors: [] };
}

export function fail(errors) {
  return { ok: false, errors };
}

export function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

export function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function defaultIdGenerator() {
  return crypto.randomUUID();
}

export function resolveIdGenerator(idGenerator) {
  return typeof idGenerator === 'function' ? idGenerator : defaultIdGenerator;
}

export function nextPowerOfTwo(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 2;
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

export function competitionByeCount(teamCount) {
  const n = Number(teamCount);
  if (!Number.isInteger(n) || n < 2) return 0;
  return nextPowerOfTwo(n) - n;
}

/**
 * Posições de seed 1..size no padrão clássico de chave.
 * size=8 → [1, 8, 4, 5, 2, 7, 3, 6] → confrontos 1×8, 4×5, 2×7, 3×6.
 * Os melhores seeds ficam em metades opostas e recebem os BYEs das posições altas vazias.
 */
export function seedBracketOrder(size) {
  const n = Number(size);
  if (!Number.isInteger(n) || n < 2) return [];
  let seeds = [1];
  while (seeds.length < n) {
    const nextSize = seeds.length * 2;
    const next = [];
    for (const seed of seeds) {
      next.push(seed);
      next.push(nextSize + 1 - seed);
    }
    seeds = next;
  }
  return seeds;
}

export function cloneCompetitionSource(source) {
  if (!isPlainObject(source)) return source ?? null;
  if (source.type === 'team') return { type: 'team', teamId: source.teamId };
  if (source.type === 'winner' || source.type === 'loser') {
    return { type: source.type, matchId: source.matchId };
  }
  if (source.type === 'seed') return { type: 'seed', seed: source.seed };
  return { ...source };
}

export function pendingMatchFields() {
  return {
    scoreA: null,
    scoreB: null,
    playedDate: null,
    winnerTeamId: null,
  };
}

export function cloneCompetitionMatch(match) {
  return {
    id: match?.id,
    roundId: match?.roundId,
    sourceA: cloneCompetitionSource(match?.sourceA),
    sourceB: cloneCompetitionSource(match?.sourceB),
    teamAId: match?.teamAId ?? null,
    teamBId: match?.teamBId ?? null,
    lineupA: cloneTeamMembers(match?.lineupA),
    lineupB: cloneTeamMembers(match?.lineupB),
    scoreA: match?.scoreA ?? null,
    scoreB: match?.scoreB ?? null,
    playedDate: match?.playedDate ?? null,
    winnerTeamId: match?.winnerTeamId ?? null,
  };
}

export function cloneCompetitionBye(bye) {
  return { teamId: bye?.teamId ?? null };
}

export function cloneCompetitionRound(round) {
  return {
    id: round?.id,
    number: round?.number,
    name: round?.name ?? null,
    bracket: round?.bracket ?? null,
    matches: (round?.matches ?? []).map(cloneCompetitionMatch),
    byes: (round?.byes ?? []).map(cloneCompetitionBye),
  };
}

export function emptyMatch(id, roundId, sourceA, sourceB) {
  return {
    id,
    roundId,
    sourceA: cloneCompetitionSource(sourceA),
    sourceB: cloneCompetitionSource(sourceB),
    teamAId: sourceA?.type === 'team' ? sourceA.teamId : null,
    teamBId: sourceB?.type === 'team' ? sourceB.teamId : null,
    lineupA: [],
    lineupB: [],
    ...pendingMatchFields(),
  };
}

export function isByeSlot(slot) {
  return slot == null || slot.type === 'bye';
}

export function pairKey(leftId, rightId) {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

export function stageNameForType(type, index = 0) {
  if (type === 'swiss') return 'Sistema suíço';
  if (type === 'double_elimination') return 'Double elimination';
  if (type === 'single_elimination') return 'Eliminação simples';
  if (type === 'round_robin') return 'Todos contra todos';
  if (type === 'groups') return 'Grupos';
  return `Fase ${index + 1}`;
}

export function roundNameForSlotCount(slotCount) {
  if (slotCount <= 2) return 'Final';
  if (slotCount <= 4) return 'Semifinal';
  if (slotCount <= 8) return 'Quartas de final';
  if (slotCount <= 16) return 'Oitavas de final';
  return `Rodada de ${slotCount}`;
}
