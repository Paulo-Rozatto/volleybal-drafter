import { generateRoundRobinSchedule } from './domain/roundRobin.js';
import { validateDate } from './domain/sessionValidation.js';
import {
  TEAM_SESSION_SCHEMA_VERSION,
  cloneV2Team,
  createInitialLineups,
  validateFormat,
  validateSessionTeams,
  validateTeam,
} from './domain/teamSession.js';

export const DEFAULT_TEAM_SESSION_FORMAT = {
  teamSize: 2,
  teamCount: 2,
};

export const REPLACE_TEAMS_CONFIRMATION_MESSAGE =
  'Este sorteio substituirá todos os times atuais. Deseja continuar?';

export const GENERATE_TEAM_ROUNDS_CONFIRMATION_MESSAGE =
  'Depois de gerar as rodadas, os times ficarão bloqueados. Deseja continuar?';

export const RESET_TEAM_SESSION_TO_DRAFT_CONFIRMATION_MESSAGE =
  'Alterar os times apagará todas as rodadas e placares deste encontro. Deseja continuar?';

/**
 * Sorteio automático futuro (não implementado nesta etapa).
 *
 * `generateBalancedTeams` deverá distribuir todos os jogadores selecionados, sem banco, com:
 * `teamCount <= selectedPlayers.length <= teamSize * teamCount`.
 * Os tamanhos dos times devem diferir no máximo em um, quando possível.
 */

function fail(errors) {
  return { ok: false, errors, document: null, session: null, team: null };
}

function succeed({ document, session, team = null }) {
  return { ok: true, errors: [], document, session, team };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function normalizeSessionName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed === '' ? null : trimmed;
}

function resolveFormat(inputFormat) {
  if (inputFormat == null) return { ...DEFAULT_TEAM_SESSION_FORMAT };
  return {
    teamSize: inputFormat.teamSize,
    teamCount: inputFormat.teamCount,
  };
}

function findSession(document, sessionId) {
  return (document?.sessions ?? []).find((item) => item?.id === sessionId) ?? null;
}

function replaceSession(document, sessionId, nextSession) {
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  return {
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions: sessions.map((item) => (item?.id === sessionId ? nextSession : item)),
  };
}

function snapshotMember(player) {
  return {
    playerId: player?.id,
    playerName: typeof player?.name === 'string' ? player.name.trim() : '',
  };
}

function membersFromIds(memberIds, roster) {
  const byId = new Map((roster ?? []).map((player) => [player?.id, player]));
  return (memberIds ?? []).map((id) => {
    const player = byId.get(id);
    return player ? snapshotMember(player) : { playerId: id, playerName: '' };
  });
}

function cloneTeams(teams) {
  return (teams ?? []).map(cloneV2Team);
}

function withUpdatedTeams(session, teams, now) {
  const clock = now ?? (() => new Date());
  return {
    ...session,
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams: cloneTeams(teams),
    rounds: [],
    status: 'draft',
    updatedAt: clock().toISOString(),
  };
}

export function canEditSessionTeams(session) {
  return session?.status === 'draft' && (!Array.isArray(session?.rounds) || session.rounds.length === 0);
}

function lockedResult(session) {
  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }
  if (!canEditSessionTeams(session)) {
    return fail([
      error('TEAMS_LOCKED', 'Só é possível alterar times em um encontro em rascunho sem rodadas.'),
    ]);
  }
  return null;
}

function validateDraftTeamSet(teams, format, roster) {
  const formatResult = validateFormat(format);
  if (!formatResult.ok) return formatResult;

  if (!Array.isArray(teams)) {
    return fail([error('TEAMS_NOT_ARRAY', 'Os times do encontro precisam ser uma lista.')]);
  }

  if (teams.length > format.teamCount) {
    return fail([
      error(
        'TEAM_COUNT_EXCEEDED',
        `O encontro não pode ter mais de ${format.teamCount} times.`,
        { expected: format.teamCount, actual: teams.length }
      ),
    ]);
  }

  const errors = [];
  teams.forEach((team, index) => {
    const otherTeams = teams.filter((_, otherIndex) => otherIndex !== index);
    const result = validateTeam(team, format, roster, otherTeams);
    if (!result.ok) {
      errors.push(
        ...result.errors.map((item) => ({
          ...item,
          teamIndex: index,
          teamId: team?.id,
        }))
      );
    }
  });

  return errors.length > 0 ? fail(errors) : { ok: true, errors: [] };
}

function commitTeams(document, session, nextTeams, roster, now, team) {
  const setResult = validateDraftTeamSet(nextTeams, session.format, roster);
  if (!setResult.ok) return fail(setResult.errors);

  const updatedSession = withUpdatedTeams(session, nextTeams, now);
  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
    team,
  });
}

export function createDraftTeamSession(input = {}, { idGenerator, now } = {}) {
  const dateResult = validateDate(input.date);
  if (!dateResult.ok) {
    throw new Error(dateResult.errors[0]?.message || 'A data do encontro é inválida.');
  }

  const format = resolveFormat(input.format);
  const formatResult = validateFormat(format);
  if (!formatResult.ok) {
    throw new Error(formatResult.errors[0]?.message || 'O formato do encontro é inválido.');
  }

  const createId = idGenerator ?? (() => crypto.randomUUID());
  const clock = now ?? (() => new Date());
  const createdAt = clock().toISOString();

  return {
    id: createId(),
    date: input.date,
    name: normalizeSessionName(input.name),
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    format: {
      teamSize: format.teamSize,
      teamCount: format.teamCount,
    },
    teams: [],
    rounds: [],
  };
}

export function appendDraftTeamSession(document, input, options) {
  const session = createDraftTeamSession(input, options);
  const currentSessions = Array.isArray(document?.sessions) ? document.sessions : [];

  return {
    document: {
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [...currentSessions, session],
    },
    session,
  };
}

export function takenTeamPlayerIds(teams, ignoredTeamId) {
  const ids = new Set();
  for (const team of teams ?? []) {
    if (ignoredTeamId && team?.id === ignoredTeamId) continue;
    for (const member of team?.members ?? []) {
      if (typeof member?.playerId === 'string' && member.playerId.trim()) {
        ids.add(member.playerId);
      }
    }
  }
  return ids;
}

export function availablePlayersForTeams(roster, teams, ignoredTeamId) {
  const taken = takenTeamPlayerIds(teams, ignoredTeamId);
  return (roster ?? []).filter((player) => player?.id && !taken.has(player.id));
}

export function teamMemberIdsInRoster(team, roster) {
  const knownIds = new Set((roster ?? []).map((player) => player?.id).filter(Boolean));
  const ids = [];
  for (const member of team?.members ?? []) {
    const playerId = member?.playerId;
    if (knownIds.has(playerId) && !ids.includes(playerId)) {
      ids.push(playerId);
    }
  }
  return ids;
}

export function addSessionTeam(document, sessionId, memberIds = [], options = {}) {
  const { roster, idGenerator, now } = options;
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  if (memberIds != null && !Array.isArray(memberIds)) {
    return fail([error('TEAM_MEMBERS_NOT_ARRAY', 'Os integrantes do time precisam ser uma lista.')]);
  }

  const createId = idGenerator ?? (() => crypto.randomUUID());
  const team = {
    id: createId(),
    members: membersFromIds(memberIds ?? [], roster),
  };

  return commitTeams(document, session, [...(session.teams ?? []), team], roster, now, team);
}

export function updateSessionTeam(document, sessionId, teamId, memberIds = [], options = {}) {
  const { roster, now } = options;
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  if (memberIds != null && !Array.isArray(memberIds)) {
    return fail([error('TEAM_MEMBERS_NOT_ARRAY', 'Os integrantes do time precisam ser uma lista.')]);
  }

  const currentTeams = session.teams ?? [];
  const teamIndex = currentTeams.findIndex((item) => item?.id === teamId);
  if (teamIndex < 0) {
    return fail([error('TEAM_NOT_FOUND', 'Time não encontrado.')]);
  }

  const team = {
    id: teamId,
    members: membersFromIds(memberIds ?? [], roster),
  };
  const nextTeams = currentTeams.map((item, index) => (index === teamIndex ? team : item));
  return commitTeams(document, session, nextTeams, roster, now, team);
}

export function removeSessionTeam(document, sessionId, teamId, options = {}) {
  const { roster, now } = options;
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  const currentTeams = session.teams ?? [];
  if (!currentTeams.some((item) => item?.id === teamId)) {
    return fail([error('TEAM_NOT_FOUND', 'Time não encontrado.')]);
  }

  const nextTeams = currentTeams.filter((item) => item.id !== teamId);
  return commitTeams(document, session, nextTeams, roster, now, null);
}

/**
 * Substitui o conjunto de times-base. Destinado também ao sorteio automático futuro,
 * que deverá respeitar `teamCount <= selectedPlayers.length <= teamSize * teamCount`.
 */
export function replaceSessionTeams(document, sessionId, teams, options = {}) {
  const { roster, now, replaceConfirmed = false } = options;
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  if (!Array.isArray(teams)) {
    return fail([error('TEAMS_NOT_ARRAY', 'Os times do encontro precisam ser uma lista.')]);
  }

  const hasExisting = (session.teams?.length ?? 0) > 0;
  if (hasExisting && !replaceConfirmed) {
    return fail([
      error('REPLACE_CONFIRMATION_REQUIRED', REPLACE_TEAMS_CONFIRMATION_MESSAGE),
    ]);
  }

  return commitTeams(document, session, teams, roster, now, null);
}

function teamsReadyForRounds(session, roster) {
  if (!session || session.status !== 'draft') return false;
  if (Array.isArray(session.rounds) && session.rounds.length > 0) return false;
  if (!Array.isArray(session.teams) || session.teams.length < 2) return false;

  const setResult = validateSessionTeams(session.teams, session.format, roster);
  if (!setResult.ok) return false;
  return session.teams.every((team) => Array.isArray(team?.members) && team.members.length >= 1);
}

export function canGenerateTeamSessionRounds(session, roster) {
  return teamsReadyForRounds(session, roster);
}

function generationBlockers(session, roster) {
  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  if (session.status !== 'draft') {
    return fail([
      error('SESSION_NOT_DRAFT', 'Só é possível gerar rodadas em um encontro em rascunho.'),
    ]);
  }

  if (Array.isArray(session.rounds) && session.rounds.length > 0) {
    return fail([error('ROUNDS_ALREADY_EXIST', 'Este encontro já possui rodadas.')]);
  }

  const formatResult = validateFormat(session.format);
  if (!formatResult.ok) return fail(formatResult.errors);

  const teams = Array.isArray(session.teams) ? session.teams : [];
  if (teams.length < 2) {
    return fail([
      error('TOO_FEW_TEAMS', 'Forme pelo menos dois times para gerar os jogos.'),
    ]);
  }

  const setResult = validateSessionTeams(teams, session.format, roster);
  if (!setResult.ok) return fail(setResult.errors);

  if (teams.some((team) => !Array.isArray(team?.members) || team.members.length < 1)) {
    return fail([
      error('TEAM_EMPTY', 'Cada time precisa de pelo menos um jogador para gerar as rodadas.'),
    ]);
  }

  return null;
}

function roundsFromSchedule(schedule, teams) {
  const byId = new Map((teams ?? []).map((team) => [team.id, team]));
  return schedule.map((round) => ({
    id: round.id,
    number: round.number,
    byeTeamId: round.byeTeamId,
    matches: round.matches.map((match) => {
      const { lineupA, lineupB } = createInitialLineups(byId.get(match.teamAId), byId.get(match.teamBId));
      return {
        id: match.id,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        lineupA,
        lineupB,
        scoreA: null,
        scoreB: null,
      };
    }),
  }));
}

export function startTeamSessionRoundRobin(document, sessionId, options = {}) {
  const { idGenerator, now, roster, generateConfirmed = false } = options;
  const session = findSession(document, sessionId);
  const blocked = generationBlockers(session, roster);
  if (blocked) return blocked;

  if (!generateConfirmed) {
    return fail([
      error('GENERATE_ROUNDS_CONFIRMATION_REQUIRED', GENERATE_TEAM_ROUNDS_CONFIRMATION_MESSAGE),
    ]);
  }

  let schedule;
  try {
    schedule = generateRoundRobinSchedule(session.teams, idGenerator ?? (() => crypto.randomUUID()));
  } catch (caught) {
    return fail([
      error('ROUND_ROBIN_FAILED', caught.message || 'Não foi possível gerar as rodadas.'),
    ]);
  }

  const teams = cloneTeams(session.teams);
  const rounds = roundsFromSchedule(schedule, teams);
  const clock = now ?? (() => new Date());
  const updatedSession = {
    ...session,
    status: 'in_progress',
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams,
    rounds,
    updatedAt: clock().toISOString(),
  };

  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export function resetTeamSessionToDraftForTeamEditing(document, sessionId, options = {}) {
  const { now, resetConfirmed = false } = options;
  const session = findSession(document, sessionId);

  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  if (session.status === 'finished') {
    return fail([
      error('SESSION_FINISHED', 'Não é possível alterar times de um encontro finalizado.'),
    ]);
  }

  if (session.status !== 'in_progress') {
    return fail([
      error('SESSION_NOT_IN_PROGRESS', 'Só é possível alterar times de um encontro em andamento.'),
    ]);
  }

  if (!resetConfirmed) {
    return fail([
      error('RESET_TO_DRAFT_CONFIRMATION_REQUIRED', RESET_TEAM_SESSION_TO_DRAFT_CONFIRMATION_MESSAGE),
    ]);
  }

  const clock = now ?? (() => new Date());
  const updatedSession = {
    ...session,
    status: 'draft',
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams: cloneTeams(session.teams),
    rounds: [],
    updatedAt: clock().toISOString(),
  };

  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}
