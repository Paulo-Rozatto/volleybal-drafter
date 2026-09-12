import { isMatchCompleted, isMatchPending } from './domain/sessionValidation.js';

export const MISSING_PAIR_LABEL = 'Dupla não encontrada';

export function formatPairLabel(pair) {
  const names = (pair?.members ?? [])
    .map((member) => (typeof member?.playerName === 'string' ? member.playerName.trim() : ''))
    .filter((name) => name.length > 0);

  if (names.length === 0) return MISSING_PAIR_LABEL;
  return names.join(' + ');
}

export function resolvePairLabel(pairs, pairId) {
  if (typeof pairId !== 'string' || pairId.trim().length === 0) {
    return MISSING_PAIR_LABEL;
  }

  const pair = (pairs ?? []).find((item) => item?.id === pairId);
  return pair ? formatPairLabel(pair) : MISSING_PAIR_LABEL;
}

export function resolveByeLabel(pairs, byePairId) {
  if (byePairId == null) return null;
  return resolvePairLabel(pairs, byePairId);
}

export function roundsInOrder(rounds) {
  return [...(Array.isArray(rounds) ? rounds : [])].sort(
    (left, right) => (left?.number ?? 0) - (right?.number ?? 0)
  );
}

export function formatMatchScore(match) {
  if (isMatchPending(match)) return '— × —';
  if (typeof match?.scoreA === 'number' && typeof match?.scoreB === 'number') {
    return `${match.scoreA} × ${match.scoreB}`;
  }
  return '— × —';
}

export function matchWinningSide(match) {
  if (!isMatchCompleted(match)) return null;
  return match.scoreA > match.scoreB ? 'A' : 'B';
}
