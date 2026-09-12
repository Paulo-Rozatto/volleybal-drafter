export const SESSION_FORMAT_OPTIONS = [
  { teamSize: 2, label: '2x2' },
  { teamSize: 3, label: '3x3' },
  { teamSize: 4, label: '4x4' },
  { teamSize: 5, label: '5x5' },
  { teamSize: 6, label: '6x6' },
];

export const EMPTY_TEAM_CONFIRMATION_MESSAGE = 'Criar este time sem jogadores?';
export const EMPTY_TEAM_CONFIRM_LABEL = 'Criar time vazio';
export const GENERATE_ROUNDS_MISSING_TEAMS_MESSAGE =
  'Crie todos os times do encontro antes de gerar os jogos.';
export const GENERATE_ROUNDS_EMPTY_TEAM_MESSAGE =
  'Cada time precisa ter pelo menos um jogador para gerar os jogos.';

export function usesDoublesLabels(sessionOrTeamSize) {
  if (sessionOrTeamSize != null && typeof sessionOrTeamSize === 'object') {
    return sessionOrTeamSize.format?.teamSize === 2;
  }
  return sessionOrTeamSize === 2;
}

export function resolveTeamSize(sessionOrTeamSize, fallback = 2) {
  if (typeof sessionOrTeamSize === 'number') return sessionOrTeamSize;
  const teamSize = sessionOrTeamSize?.format?.teamSize;
  return Number.isInteger(teamSize) ? teamSize : fallback;
}

export function teamUnitSingular(teamSize) {
  return teamSize === 2 ? 'dupla' : 'time';
}

export function teamUnitPlural(teamSize) {
  return teamSize === 2 ? 'duplas' : 'times';
}

export function teamUnitNoun(teamSize, count) {
  return count === 1 ? teamUnitSingular(teamSize) : teamUnitPlural(teamSize);
}

export function formatFormatLabel(teamSize) {
  return `${teamSize}x${teamSize}`;
}

export function missingTeamLabel(teamSize = 2) {
  return teamSize === 2 ? 'Dupla não encontrada' : 'Time não encontrado';
}

export function memberNames(members) {
  return (Array.isArray(members) ? members : [])
    .map((member) => (typeof member?.playerName === 'string' ? member.playerName.trim() : ''))
    .filter((name) => name.length > 0);
}

export function playerNames(players) {
  return (Array.isArray(players) ? players : [])
    .map((player) => (typeof player?.name === 'string' ? player.name.trim() : ''))
    .filter((name) => name.length > 0);
}

export function formatDoublesNames(names) {
  if (!Array.isArray(names) || names.length === 0) return missingTeamLabel(2);
  return names.join(' + ');
}

export function formatIndexedTeamNames(names, index) {
  const title = `Time ${index + 1}`;
  if (!Array.isArray(names) || names.length === 0) return `${title}: Sem jogadores`;
  return `${title}: ${names.join(', ')}`;
}

export function formatSessionTeamLabel(team, { teamSize = 2, index = 0 } = {}) {
  const names = memberNames(team?.members);
  if (teamSize === 2) return formatDoublesNames(names);
  return formatIndexedTeamNames(names, index);
}

export function formatMatchSideLabel({ lineup, teams = [], teamId, teamSize = 2 } = {}) {
  const names = memberNames(lineup);
  if (teamSize === 2) return formatDoublesNames(names);

  const index = (teams ?? []).findIndex((item) => item?.id === teamId);
  if (index < 0 && names.length === 0) return missingTeamLabel(teamSize);
  return formatIndexedTeamNames(names, index < 0 ? 0 : index);
}

export function allTeamsFormedMessage(formedCount, teamCount, teamSize) {
  return teamSize === 2
    ? `Todas as duplas já foram formadas (${formedCount}/${teamCount}).`
    : `Todos os times já foram formados (${formedCount}/${teamCount}).`;
}

export function teamsLockedMessage(teamSize) {
  return teamSize === 2
    ? 'Este encontro não está em rascunho ou já possui rodadas. As duplas não podem ser alteradas.'
    : 'Este encontro não está em rascunho ou já possui rodadas. Os times não podem ser alterados.';
}

export function noAvailablePlayersMessage(teamSize) {
  return teamSize === 2
    ? 'Não há jogadores disponíveis para novas duplas.'
    : 'Não há jogadores disponíveis para novos times.';
}

export function formedTeamsHeading(formedCount, teamCount, teamSize) {
  const title = teamSize === 2 ? 'Duplas formadas' : 'Times formados';
  return `${title} (${formedCount}/${teamCount})`;
}

export function formatTeamCountPhrase(count, teamSize) {
  return `${count} ${teamUnitNoun(teamSize, count)}`;
}

export function addTeamActionLabel(teamSize, isEditing) {
  if (isEditing) return 'Salvar alteração';
  return teamSize === 2 ? 'Adicionar dupla' : 'Adicionar time';
}

export function selectedCountLabel(selectedCount, teamSize) {
  return `Selecionados: ${selectedCount} de até ${teamSize}`;
}

export function generateRoundsConfirmationMessage(teamSize) {
  return teamSize === 2
    ? 'Depois de gerar as rodadas, as duplas ficarão bloqueadas. Deseja continuar?'
    : 'Depois de gerar as rodadas, os times ficarão bloqueados. Deseja continuar?';
}

export function resetToDraftConfirmationMessage(teamSize) {
  return teamSize === 2
    ? 'Alterar as duplas apagará todas as rodadas e placares deste encontro. Deseja continuar?'
    : 'Alterar os times apagará todas as rodadas e placares deste encontro. Deseja continuar?';
}

export function replaceTeamsConfirmationMessage(teamSize) {
  return teamSize === 2
    ? 'Este sorteio substituirá todas as duplas atuais. Deseja continuar?'
    : 'Este sorteio substituirá todos os times atuais. Deseja continuar?';
}

export function alterTeamsLabel(teamSize) {
  return teamSize === 2 ? 'Alterar duplas' : 'Alterar times';
}

export function drawTeamsLabel(teamSize) {
  return teamSize === 2 ? 'Sortear duplas' : 'Sortear times';
}
