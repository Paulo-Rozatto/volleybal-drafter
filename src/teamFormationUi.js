import { validateFormat } from './domain/teamSession.js';
import {
  GENERATE_ROUNDS_EMPTY_TEAM_MESSAGE,
  GENERATE_ROUNDS_MISSING_TEAMS_MESSAGE,
} from './teamPresentation.js';

export function parseRequiredInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

export function parseSessionFormatInput({ teamSize, teamCount } = {}) {
  const parsedSize = parseRequiredInteger(teamSize);
  const parsedCount = parseRequiredInteger(teamCount);
  const format = { teamSize: parsedSize, teamCount: parsedCount };
  const result = validateFormat(format);
  const teamSizeError = result.errors.find((item) => item.field === 'teamSize')?.message ?? null;
  const teamCountError = result.errors.find((item) => item.field === 'teamCount')?.message ?? null;

  return {
    ok: result.ok,
    format: result.ok ? { teamSize: parsedSize, teamCount: parsedCount } : format,
    errors: result.errors,
    teamSizeError,
    teamCountError,
  };
}

export function requiresExactPair(teamSize) {
  return teamSize === 2;
}

export function canSelectAnotherMember(teamSize, selectedCount) {
  return selectedCount < teamSize;
}

export function needsEmptyTeamConfirmation(teamSize, selectedCount) {
  return teamSize > 2 && selectedCount === 0;
}

export function canSubmitManualTeam(teamSize, selectedCount) {
  if (!Number.isInteger(teamSize) || selectedCount < 0) return false;
  if (teamSize === 2) return selectedCount === 2;
  return selectedCount <= teamSize;
}

export function manualTeamSubmitError(teamSize, selectedCount) {
  if (teamSize === 2 && selectedCount !== 2) {
    return 'Selecione dois jogadores para formar a dupla.';
  }
  if (selectedCount > teamSize) {
    return `O time não pode ter mais de ${teamSize} jogadores.`;
  }
  return null;
}

export function toggleSelectedPlayer(selected, player, teamSize) {
  const current = Array.isArray(selected) ? selected : [];
  if (!player?.id) return [...current];
  const index = current.findIndex((item) => item?.id === player.id);
  if (index >= 0) return current.filter((_, itemIndex) => itemIndex !== index);
  if (current.length >= teamSize) return [...current];
  return [...current, player];
}

export function generateRoundsBlockedReason(session) {
  const teams = Array.isArray(session?.teams) ? session.teams : [];
  const teamCount = session?.format?.teamCount;
  if (!Number.isInteger(teamCount) || teams.length !== teamCount) {
    return GENERATE_ROUNDS_MISSING_TEAMS_MESSAGE;
  }
  if (teams.some((team) => !Array.isArray(team?.members) || team.members.length < 1)) {
    return GENERATE_ROUNDS_EMPTY_TEAM_MESSAGE;
  }
  return null;
}

export function automaticDrawAvailable(teamSize) {
  return teamSize === 2;
}

export function automaticDrawRequiredPlayers(teamCount) {
  return teamCount * 2;
}
