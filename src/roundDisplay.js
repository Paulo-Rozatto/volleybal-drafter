import { isMatchCompleted, isMatchPending } from './domain/sessionValidation.js';

export const MISSING_TEAM_LABEL = 'Dupla não encontrada';

export function formatTeamLabel(team) {
  const names = (team?.members ?? [])
    .map((member) => (typeof member?.playerName === 'string' ? member.playerName.trim() : ''))
    .filter((name) => name.length > 0);

  if (names.length === 0) return MISSING_TEAM_LABEL;
  return names.join(' + ');
}

export function resolveTeamLabel(teams, teamId) {
  if (typeof teamId !== 'string' || teamId.trim().length === 0) {
    return MISSING_TEAM_LABEL;
  }

  const team = (teams ?? []).find((item) => item?.id === teamId);
  return team ? formatTeamLabel(team) : MISSING_TEAM_LABEL;
}

export function resolveByeLabel(teams, byeTeamId) {
  if (byeTeamId == null) return null;
  return resolveTeamLabel(teams, byeTeamId);
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
