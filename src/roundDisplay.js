import { isMatchCompleted, isMatchPending } from './domain/sessionValidation.js';
import {
  formatDoublesNames,
  formatMatchSideLabel,
  formatSessionTeamLabel,
  memberNames,
  missingTeamLabel,
} from './teamPresentation.js';

export const MISSING_TEAM_LABEL = missingTeamLabel(2);

export function formatTeamLabel(team, { teamSize = 2, index = 0 } = {}) {
  if (teamSize === 2) return formatDoublesNames(memberNames(team?.members));
  return formatSessionTeamLabel(team, { teamSize, index });
}

export function resolveTeamLabel(teams, teamId, { teamSize = 2 } = {}) {
  if (typeof teamId !== 'string' || teamId.trim().length === 0) {
    return missingTeamLabel(teamSize);
  }

  const index = (teams ?? []).findIndex((item) => item?.id === teamId);
  if (index < 0) return missingTeamLabel(teamSize);
  return formatTeamLabel(teams[index], { teamSize, index });
}

export function resolveByeLabel(teams, byeTeamId, { teamSize = 2 } = {}) {
  if (byeTeamId == null) return null;
  return resolveTeamLabel(teams, byeTeamId, { teamSize });
}

export function resolveMatchSideLabel(match, side, teams, teamSize = 2) {
  const lineup = side === 'A' ? match?.lineupA : match?.lineupB;
  const teamId = side === 'A' ? match?.teamAId : match?.teamBId;
  return formatMatchSideLabel({ lineup, teams, teamId, teamSize });
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
