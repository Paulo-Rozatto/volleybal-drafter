import {
  generateBlockedRoundRobinSchedule,
  generateRoundRobinSchedule,
} from './domain/roundRobin.js';
import {
  countSessionMatches,
  isMatchCompleted,
  sessionIsReadyToFinalize,
  validateCanFinalize,
  validateDate,
  validateScore,
} from './domain/sessionValidation.js';
import {
  TEAM_SESSION_SCHEMA_VERSION,
  cloneTeamMembers,
  cloneV2Round,
  cloneV2Session,
  cloneV2Team,
  collectSessionSnapshotPlayerIds,
  createInitialLineups,
  roundCycleNumber,
  validateCourtCount,
  validateFormat,
  validateMatchLineups,
  validateSessionTeams,
  validateTeam,
  validateV2Document,
} from './domain/teamSession.js';
import {
  formatFinalizeMatchProgress,
  generateRoundsConfirmationMessage,
  replaceTeamsConfirmationMessage,
  resetToDraftConfirmationMessage,
} from './teamPresentation.js';

export { usesDoublesLabels } from './teamPresentation.js';

export const DEFAULT_TEAM_SESSION_FORMAT = {
  teamSize: 2,
  teamCount: 2,
};

export const REPLACE_TEAMS_CONFIRMATION_MESSAGE = replaceTeamsConfirmationMessage(6);

export const GENERATE_TEAM_ROUNDS_CONFIRMATION_MESSAGE = generateRoundsConfirmationMessage(6);

export const APPEND_ROUND_ROBIN_CYCLE_CONFIRMATION_MESSAGE =
  'Gerar um novo todos-contra-todos com as mesmas duplas, sem apagar os jogos anteriores?';

export const RESET_TEAM_SESSION_TO_DRAFT_CONFIRMATION_MESSAGE = resetToDraftConfirmationMessage(6);

export const CLEAR_SCORE_CONFIRMATION_MESSAGE =
  'Remover o placar desta partida e marcá-la novamente como pendente?';

export const FINALIZE_TEAM_SESSION_CONFIRMATION_MESSAGE =
  'Depois da finalização, times e escalações ficarão bloqueados. Os placares ainda poderão ser corrigidos.';

export const FORMAT_CHANGE_CONFIRMATION_REQUIRED = 'FORMAT_CHANGE_CONFIRMATION_REQUIRED';
export const FORMAT_CHANGE_CONFIRMATION_MESSAGE =
  'Alterar o formato removerá todos os times já montados. Deseja continuar?';

export const DELETE_TEAM_SESSION_CONFIRMATION_REQUIRED = 'DELETE_TEAM_SESSION_CONFIRMATION_REQUIRED';
export const DELETE_TEAM_SESSION_CONFIRMATION_MESSAGE = 'Excluir este encontro permanentemente?';
export const DELETE_TEAM_SESSION_SIDE_EFFECTS_WARNING =
  'Times, escalações, placares e estatísticas derivadas também deixarão de existir.';
export const DELETE_FINISHED_TEAM_SESSION_WARNING =
  'Este encontro já está finalizado. A exclusão apaga times, escalações, placares e qualquer estatística derivada. Esta ação não pode ser desfeita.';

const STATUS_LABELS = {
  draft: 'Rascunho',
  in_progress: 'Em andamento',
  finished: 'Finalizado',
};

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatSessionDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date ?? '';
  }

  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function translateSessionStatus(status) {
  return STATUS_LABELS[status] ?? status;
}

export function sessionsForDisplay(sessions) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
    const byDate = String(right?.date ?? '').localeCompare(String(left?.date ?? ''));
    if (byDate !== 0) return byDate;
    return String(right?.createdAt ?? '').localeCompare(String(left?.createdAt ?? ''));
  });
}

export function sessionDisplayName(session) {
  return session?.name || 'Encontro sem nome';
}

export function sessionListStats(session) {
  const teamCount = Array.isArray(session?.teams) ? session.teams.length : 0;
  const { total } = countSessionMatches(session);
  return { teamCount, matchCount: total };
}

export function teamSessionRoundSummary(session) {
  const roundCount = Array.isArray(session?.rounds) ? session.rounds.length : 0;
  const matches = countSessionMatches(session);
  return {
    roundCount,
    matchCount: matches.total,
    completedCount: matches.completed,
    pendingCount: matches.pending,
    invalidCount: matches.invalid,
  };
}

export function teamSessionIsReadyToFinalize(session) {
  return sessionIsReadyToFinalize(session);
}

export function canEnableFinalizeTeamSession(session) {
  return session?.status === 'in_progress' && sessionIsReadyToFinalize(session);
}

export function teamSessionFinalizeProgressLabel(session) {
  const { completed, total } = countSessionMatches(session);
  return formatFinalizeMatchProgress(completed, total);
}

function normalizeSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function filterPlayersByName(players, query) {
  const needle = normalizeSearch(query);
  const list = Array.isArray(players) ? players : [];
  if (!needle) return [...list];
  return list.filter((player) => normalizeSearch(player?.name).includes(needle));
}


/**
 * O sorteio automático (`generateBalancedTeams`) distribui todos os selecionados, sem banco.
 * 2x2 exige `teamCount * 2`; 3x3–6x6 aceita `teamCount` até `teamSize * teamCount`.
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

function membersFromIds(memberIds, roster, previousMembers = [], { refreshFromRoster = true } = {}) {
  const byId = new Map((roster ?? []).map((player) => [player?.id, player]));
  const previousById = new Map(
    (previousMembers ?? [])
      .filter((member) => typeof member?.playerId === 'string' && member.playerId.trim())
      .map((member) => [member.playerId, member])
  );
  return (memberIds ?? []).map((id) => {
    const previous = previousById.get(id);
    if (previous && !refreshFromRoster) {
      return {
        playerId: previous.playerId,
        playerName: previous.playerName,
      };
    }
    const player = byId.get(id);
    if (player) return snapshotMember(player);
    if (previous) {
      return {
        playerId: previous.playerId,
        playerName: previous.playerName,
      };
    }
    return { playerId: id, playerName: '' };
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

export function canEditSessionScores(session) {
  return session?.status === 'in_progress' || session?.status === 'finished';
}

export function canClearSessionScores(session) {
  return session?.status === 'in_progress';
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

function validateDraftTeamSet(teams, format, roster, existingMemberIds = []) {
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
    const result = validateTeam(team, format, roster, otherTeams, { existingMemberIds });
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
  const existingMemberIds = [...collectSessionSnapshotPlayerIds(session)];
  const setResult = validateDraftTeamSet(nextTeams, session.format, roster, existingMemberIds);
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

export function updateTeamSessionDetails(document, sessionId, changes = {}, options = {}) {
  const schemaError = requireV2Document(document);
  if (schemaError) return schemaError;

  const session = findSession(document, sessionId);
  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  const nextDate = Object.prototype.hasOwnProperty.call(changes, 'date') ? changes.date : session.date;
  const dateResult = validateDate(nextDate);
  if (!dateResult.ok) return fail(dateResult.errors);

  const nextName = Object.prototype.hasOwnProperty.call(changes, 'name')
    ? normalizeSessionName(changes.name)
    : session.name;

  const wantsFormatChange =
    Object.prototype.hasOwnProperty.call(changes, 'teamSize') ||
    Object.prototype.hasOwnProperty.call(changes, 'teamCount') ||
    Object.prototype.hasOwnProperty.call(changes, 'format');

  let nextFormat = {
    teamSize: session.format.teamSize,
    teamCount: session.format.teamCount,
  };

  if (wantsFormatChange) {
    if (changes.format && typeof changes.format === 'object') {
      nextFormat = {
        teamSize: Object.prototype.hasOwnProperty.call(changes.format, 'teamSize')
          ? changes.format.teamSize
          : nextFormat.teamSize,
        teamCount: Object.prototype.hasOwnProperty.call(changes.format, 'teamCount')
          ? changes.format.teamCount
          : nextFormat.teamCount,
      };
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'teamSize')) {
      nextFormat.teamSize = changes.teamSize;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'teamCount')) {
      nextFormat.teamCount = changes.teamCount;
    }

    const formatResult = validateFormat(nextFormat);
    if (!formatResult.ok) return fail(formatResult.errors);

    if (session.status !== 'draft') {
      return fail([
        error('FORMAT_LOCKED', 'O formato não pode mudar após a geração dos jogos.', {
          field: 'format',
        }),
      ]);
    }
  }

  const formatChanged =
    nextFormat.teamSize !== session.format.teamSize || nextFormat.teamCount !== session.format.teamCount;
  const dateChanged = nextDate !== session.date;
  const nameChanged = nextName !== session.name;

  if (!formatChanged && !dateChanged && !nameChanged) {
    return {
      ok: true,
      errors: [],
      unchanged: true,
      document,
      session,
      team: null,
    };
  }

  const hasTeams = Array.isArray(session.teams) && session.teams.length > 0;
  if (formatChanged && hasTeams && !options.formatChangeConfirmed) {
    return fail([
      error(FORMAT_CHANGE_CONFIRMATION_REQUIRED, FORMAT_CHANGE_CONFIRMATION_MESSAGE),
    ]);
  }

  const clock = options.now ?? (() => new Date());
  const updatedSession = cloneV2Session({
    ...session,
    date: nextDate,
    name: nextName,
    format: nextFormat,
    teams: formatChanged && hasTeams ? [] : session.teams,
    rounds: formatChanged && hasTeams ? [] : session.rounds,
    updatedAt: clock().toISOString(),
  });

  const nextDocument = replaceSession(document, sessionId, updatedSession);
  const validation = validateV2Document(nextDocument);
  if (!validation.ok) return fail(validation.errors);

  return succeed({ document: nextDocument, session: updatedSession });
}

export function deleteTeamSession(document, sessionId, options = {}) {
  const schemaError = requireV2Document(document);
  if (schemaError) return schemaError;

  const session = findSession(document, sessionId);
  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  if (!options.deleteConfirmed) {
    return fail([
      error(DELETE_TEAM_SESSION_CONFIRMATION_REQUIRED, DELETE_TEAM_SESSION_CONFIRMATION_MESSAGE),
    ]);
  }

  const nextDocument = {
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions: (document.sessions ?? []).filter((item) => item?.id !== sessionId),
  };
  const validation = validateV2Document(nextDocument);
  if (!validation.ok) return fail(validation.errors);

  return succeed({ document: nextDocument, session: null });
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

export function sessionTeamMemberIdsInRoster(teams, roster) {
  const ids = [];
  for (const team of teams ?? []) {
    for (const playerId of teamMemberIdsInRoster(team, roster)) {
      if (!ids.includes(playerId)) ids.push(playerId);
    }
  }
  return ids;
}

export function teamMembersForEdit(team, roster) {
  return (team?.members ?? []).map((member) => {
    const current = (roster ?? []).find((player) => player?.id === member?.playerId);
    return current ? { ...current } : { id: member?.playerId, name: member?.playerName };
  });
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
    members: membersFromIds(memberIds ?? [], roster, currentTeams[teamIndex]?.members),
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
 * Substitui o conjunto de times-base. Usado pelo sorteio automático e pela montagem manual.
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
      error('REPLACE_CONFIRMATION_REQUIRED', replaceTeamsConfirmationMessage(session.format?.teamSize)),
    ]);
  }

  return commitTeams(document, session, teams, roster, now, null);
}

function teamsReadyForRounds(session, roster) {
  if (!session || session.status !== 'draft') return false;
  if (Array.isArray(session.rounds) && session.rounds.length > 0) return false;
  if (!Array.isArray(session.teams) || session.teams.length < 2) return false;

  const setResult = validateSessionTeams(session.teams, session.format, roster, {
    existingMemberIds: collectSessionSnapshotPlayerIds(session),
  });
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

  const setResult = validateSessionTeams(teams, session.format, roster, {
    existingMemberIds: collectSessionSnapshotPlayerIds(session),
  });
  if (!setResult.ok) return fail(setResult.errors);

  if (teams.some((team) => !Array.isArray(team?.members) || team.members.length < 1)) {
    return fail([
      error('TEAM_EMPTY', 'Cada time precisa de pelo menos um jogador para gerar as rodadas.'),
    ]);
  }

  return null;
}

function collectScheduleIds(session) {
  const used = new Set();
  for (const round of session?.rounds ?? []) {
    if (typeof round?.id === 'string' && round.id.trim() !== '') used.add(round.id);
    for (const match of round?.matches ?? []) {
      if (typeof match?.id === 'string' && match.id.trim() !== '') used.add(match.id);
    }
  }
  return used;
}

function latestCycleNumber(session) {
  const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
  if (rounds.length === 0) return 0;
  return rounds.reduce((max, round) => Math.max(max, roundCycleNumber(round)), 1);
}

function maxRoundNumber(session) {
  const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
  return rounds.reduce((max, round) => {
    const number = Number.isInteger(round?.number) ? round.number : 0;
    return number > max ? number : max;
  }, 0);
}

function matchesForCycle(session, cycleNumber) {
  return (session?.rounds ?? [])
    .filter((round) => roundCycleNumber(round) === cycleNumber)
    .flatMap((round) => round.matches ?? []);
}

export function canAppendTeamSessionRoundRobinCycle(session) {
  if (session?.status !== 'in_progress') return false;
  const cycleNumber = latestCycleNumber(session);
  if (cycleNumber < 1) return false;
  const matches = matchesForCycle(session, cycleNumber);
  return matches.length > 0 && matches.every((match) => isMatchCompleted(match));
}

function roundsFromSchedule(schedule, teams, { cycleNumber = 1 } = {}) {
  const byId = new Map((teams ?? []).map((team) => [team.id, team]));
  return schedule.map((round) => ({
    id: round.id,
    number: round.number,
    cycleNumber,
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

function buildRoundRobinRounds(teams, options = {}) {
  const {
    idGenerator,
    usedIds,
    courtCount = null,
    cycleNumber = 1,
    startRoundNumber = 1,
  } = options;
  const generator = idGenerator ?? (() => crypto.randomUUID());

  if (courtCount == null) {
    return roundsFromSchedule(
      generateRoundRobinSchedule(teams, generator, { usedIds, startRoundNumber }),
      teams,
      { cycleNumber }
    );
  }

  const courtResult = validateCourtCount(courtCount);
  if (!courtResult.ok) {
    throw Object.assign(new Error(courtResult.errors[0].message), {
      code: courtResult.errors[0].code,
      errors: courtResult.errors,
    });
  }

  return roundsFromSchedule(
    generateBlockedRoundRobinSchedule(teams, {
      courtCount,
      idGenerator: generator,
      usedIds,
      startRoundNumber,
    }),
    teams,
    { cycleNumber }
  );
}

export function startTeamSessionRoundRobin(document, sessionId, options = {}) {
  const { idGenerator, now, roster, generateConfirmed = false, courtCount = null } = options;
  const session = findSession(document, sessionId);
  const blocked = generationBlockers(session, roster);
  if (blocked) return blocked;

  if (courtCount != null) {
    const courtResult = validateCourtCount(courtCount);
    if (!courtResult.ok) return fail(courtResult.errors);
  }

  if (!generateConfirmed) {
    return fail([
      error(
        'GENERATE_ROUNDS_CONFIRMATION_REQUIRED',
        generateRoundsConfirmationMessage(session.format?.teamSize)
      ),
    ]);
  }

  let rounds;
  try {
    rounds = buildRoundRobinRounds(session.teams, {
      idGenerator,
      courtCount,
      cycleNumber: 1,
      startRoundNumber: 1,
    });
  } catch (caught) {
    if (caught?.errors) return fail(caught.errors);
    return fail([
      error('ROUND_ROBIN_FAILED', caught.message || 'Não foi possível gerar as rodadas.'),
    ]);
  }

  const teams = cloneTeams(session.teams);
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
  if (courtCount != null) updatedSession.courtCount = courtCount;

  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export function appendTeamSessionRoundRobinCycle(document, sessionId, options = {}) {
  const { idGenerator, now, roster, appendConfirmed = false, courtCount: courtCountOption } = options;
  const session = findSession(document, sessionId);

  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  if (session.status === 'finished') {
    return fail([
      error('SESSION_FINISHED', 'Não é possível gerar um novo ciclo em um encontro finalizado.'),
    ]);
  }

  if (session.status !== 'in_progress') {
    return fail([
      error('SESSION_NOT_IN_PROGRESS', 'Só é possível gerar um novo ciclo em um encontro em andamento.'),
    ]);
  }

  if (!canAppendTeamSessionRoundRobinCycle(session)) {
    return fail([
      error(
        'CYCLE_INCOMPLETE',
        'Conclua todos os jogos do ciclo atual antes de gerar uma nova sequência.'
      ),
    ]);
  }

  const setResult = validateSessionTeams(session.teams, session.format, roster, {
    existingMemberIds: collectSessionSnapshotPlayerIds(session),
  });
  if (!setResult.ok) return fail(setResult.errors);

  const courtCount =
    courtCountOption != null
      ? courtCountOption
      : Number.isInteger(session.courtCount)
        ? session.courtCount
        : null;

  if (courtCount != null) {
    const courtResult = validateCourtCount(courtCount);
    if (!courtResult.ok) return fail(courtResult.errors);
  }

  if (!appendConfirmed) {
    return fail([
      error(
        'APPEND_CYCLE_CONFIRMATION_REQUIRED',
        APPEND_ROUND_ROBIN_CYCLE_CONFIRMATION_MESSAGE
      ),
    ]);
  }

  const previousRounds = (session.rounds ?? []).map(cloneV2Round);
  let nextRounds;
  try {
    nextRounds = buildRoundRobinRounds(session.teams, {
      idGenerator,
      usedIds: collectScheduleIds(session),
      courtCount,
      cycleNumber: latestCycleNumber(session) + 1,
      startRoundNumber: maxRoundNumber(session) + 1,
    });
  } catch (caught) {
    if (caught?.errors) return fail(caught.errors);
    return fail([
      error('ROUND_ROBIN_FAILED', caught.message || 'Não foi possível gerar o novo ciclo.'),
    ]);
  }

  const clock = now ?? (() => new Date());
  const updatedSession = {
    ...session,
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams: cloneTeams(session.teams),
    rounds: [...previousRounds, ...nextRounds],
    updatedAt: clock().toISOString(),
  };

  const persisted = replaceSession(document, session.id, updatedSession);
  const documentResult = validateV2Document(persisted, roster);
  if (!documentResult.ok) return fail(documentResult.errors);

  return succeed({
    document: persisted,
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
      error(
        'RESET_TO_DRAFT_CONFIRMATION_REQUIRED',
        resetToDraftConfirmationMessage(session.format?.teamSize)
      ),
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

const SCORE_EDIT_LOCK_MESSAGES = {
  finished: 'Não é possível alterar placares de um encontro finalizado.',
  notInProgress: 'Só é possível alterar placares em um encontro em andamento ou finalizado.',
};

const SCORE_CLEAR_LOCK_MESSAGES = {
  finished: 'Não é possível remover o placar de um encontro finalizado.',
  notInProgress: 'Só é possível alterar placares em um encontro em andamento.',
};

const LINEUP_LOCK_MESSAGES = {
  finished: 'Não é possível alterar escalações de um encontro finalizado.',
  notInProgress: 'Só é possível alterar escalações em um encontro em andamento.',
};

function rejectUnlessStatuses(session, allowedStatuses, messages) {
  if (allowedStatuses.includes(session.status)) return null;

  if (session.status === 'finished') {
    return fail([error('SESSION_FINISHED', messages.finished)]);
  }

  return fail([error('SESSION_NOT_IN_PROGRESS', messages.notInProgress)]);
}

function locateSessionMatch(document, sessionId, roundId, matchId, allowedStatuses, messages) {
  const session = findSession(document, sessionId);
  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  const locked = rejectUnlessStatuses(session, allowedStatuses, messages);
  if (locked) return locked;

  const round = (session.rounds ?? []).find((item) => item?.id === roundId);
  if (!round) {
    return fail([error('ROUND_NOT_FOUND', 'Rodada não encontrada.')]);
  }

  const match = (round.matches ?? []).find((item) => item?.id === matchId);
  if (!match) {
    return fail([error('MATCH_NOT_FOUND', 'Partida não encontrada.')]);
  }

  return { ok: true, errors: [], session, round, match };
}

function locateInProgressMatch(document, sessionId, roundId, matchId, messages = LINEUP_LOCK_MESSAGES) {
  return locateSessionMatch(document, sessionId, roundId, matchId, ['in_progress'], messages);
}

function locateScoreEditableMatch(document, sessionId, roundId, matchId) {
  return locateSessionMatch(
    document,
    sessionId,
    roundId,
    matchId,
    ['in_progress', 'finished'],
    SCORE_EDIT_LOCK_MESSAGES
  );
}

function locateScoreClearableMatch(document, sessionId, roundId, matchId) {
  return locateSessionMatch(
    document,
    sessionId,
    roundId,
    matchId,
    ['in_progress'],
    SCORE_CLEAR_LOCK_MESSAGES
  );
}

function withUpdatedMatchScore(session, roundId, matchId, scoreA, scoreB, now) {
  const clock = now ?? (() => new Date());
  return {
    ...session,
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams: cloneTeams(session.teams),
    rounds: (session.rounds ?? []).map((round) => {
      if (round.id !== roundId) return round;
      return {
        ...round,
        matches: (round.matches ?? []).map((match) =>
          match.id === matchId ? { ...match, scoreA, scoreB } : match
        ),
      };
    }),
    updatedAt: clock().toISOString(),
  };
}

function commitMatchScore(document, session, roundId, matchId, scoreA, scoreB, now) {
  const updatedSession = withUpdatedMatchScore(session, roundId, matchId, scoreA, scoreB, now);
  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export function setTeamSessionMatchScore(
  document,
  sessionId,
  roundId,
  matchId,
  scoreA,
  scoreB,
  options = {}
) {
  const located = locateScoreEditableMatch(document, sessionId, roundId, matchId);
  if (!located.ok) return located;

  if (scoreA === null && scoreB === null) {
    return fail([
      error('SCORE_PARTIAL', 'O placar deve preencher os dois lados ou ficar vazio.'),
    ]);
  }

  const validation = validateScore(scoreA, scoreB);
  if (!validation.ok) return fail(validation.errors);

  return commitMatchScore(document, located.session, roundId, matchId, scoreA, scoreB, options.now);
}

export function clearTeamSessionMatchScore(document, sessionId, roundId, matchId, options = {}) {
  const { now, clearConfirmed = false } = options;
  const located = locateScoreClearableMatch(document, sessionId, roundId, matchId);
  if (!located.ok) return located;

  if (!clearConfirmed) {
    return fail([error('CLEAR_SCORE_CONFIRMATION_REQUIRED', CLEAR_SCORE_CONFIRMATION_MESSAGE)]);
  }

  return commitMatchScore(document, located.session, roundId, matchId, null, null, now);
}

function requireV2Document(document) {
  if (document == null) {
    return fail([error('DOCUMENT_REQUIRED', 'O documento de encontros é obrigatório.')]);
  }

  if (!Object.prototype.hasOwnProperty.call(document, 'schemaVersion')) {
    return fail([error('SCHEMA_VERSION_REQUIRED', 'A versão do schema é obrigatória.')]);
  }

  if (document.schemaVersion !== TEAM_SESSION_SCHEMA_VERSION) {
    return fail([
      error(
        'SCHEMA_VERSION_UNSUPPORTED',
        `Versão de schema de encontros não suportada: ${String(document.schemaVersion)}.`,
        { schemaVersion: document.schemaVersion }
      ),
    ]);
  }

  return null;
}

export function finalizeTeamSession(document, sessionId, options = {}) {
  const { now, finalizeConfirmed = false } = options;
  const schemaError = requireV2Document(document);
  if (schemaError) return schemaError;

  const session = findSession(document, sessionId);
  if (!session) {
    return fail([error('SESSION_NOT_FOUND', 'Encontro não encontrado.')]);
  }

  if (session.status === 'finished') {
    return fail([error('SESSION_FINISHED', 'Este encontro já está finalizado.')]);
  }

  if (session.status !== 'in_progress') {
    return fail([
      error('SESSION_NOT_IN_PROGRESS', 'Só é possível finalizar um encontro em andamento.'),
    ]);
  }

  const validation = validateCanFinalize(session);
  const ready = sessionIsReadyToFinalize(session);
  if (!validation.ok || !ready) {
    return fail(
      validation.errors.length > 0
        ? validation.errors
        : [
            error(
              'FINALIZE_INCOMPLETE',
              'Todos os jogos precisam ter placar antes de finalizar.'
            ),
          ]
    );
  }

  if (!finalizeConfirmed) {
    return fail([
      error('FINALIZE_CONFIRMATION_REQUIRED', FINALIZE_TEAM_SESSION_CONFIRMATION_MESSAGE),
    ]);
  }

  const clock = now ?? (() => new Date());
  const updatedSession = {
    ...session,
    status: 'finished',
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams: cloneTeams(session.teams),
    rounds: (session.rounds ?? []).map(cloneV2Round),
    updatedAt: clock().toISOString(),
  };

  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export function playerBaseTeam(teams, playerId) {
  if (typeof playerId !== 'string' || playerId.trim().length === 0) return null;
  for (const team of teams ?? []) {
    if ((team?.members ?? []).some((member) => member?.playerId === playerId)) {
      return team;
    }
  }
  return null;
}

export function playerBaseTeamIndex(teams, playerId) {
  if (typeof playerId !== 'string' || playerId.trim().length === 0) return -1;
  return (teams ?? []).findIndex((team) =>
    (team?.members ?? []).some((member) => member?.playerId === playerId)
  );
}

export function eligiblePlayersForMatchSide(teams, match, side, options = {}) {
  const ownTeamId = side === 'A' ? match?.teamAId : match?.teamBId;
  const opponentTeamId = side === 'A' ? match?.teamBId : match?.teamAId;
  const blocked = new Set(options.selectedOpponentIds ?? []);
  const rosterById = new Map((options.roster ?? []).map((player) => [player?.id, player]));
  const candidates = [];

  (teams ?? []).forEach((team, teamIndex) => {
    if (!team?.id || team.id === opponentTeamId) return;
    for (const member of team?.members ?? []) {
      const playerId = member?.playerId;
      if (typeof playerId !== 'string' || playerId.trim().length === 0) continue;
      if (blocked.has(playerId)) continue;
      const rosterPlayer = rosterById.get(playerId);
      candidates.push({
        id: playerId,
        name:
          typeof rosterPlayer?.name === 'string' && rosterPlayer.name.trim()
            ? rosterPlayer.name.trim()
            : member.playerName,
        teamId: team.id,
        teamIndex,
        isOwnTeam: team.id === ownTeamId,
      });
    }
  });

  return candidates;
}

export function restoreMatchLineupsFromBaseTeams(teams, match) {
  const teamA = (teams ?? []).find((team) => team?.id === match?.teamAId) ?? null;
  const teamB = (teams ?? []).find((team) => team?.id === match?.teamBId) ?? null;

  if (!teamA || !teamB) {
    return {
      ok: false,
      errors: [error('MATCH_TEAM_NOT_FOUND', 'Time referenciado na partida não existe.')],
      lineupAPlayerIds: null,
      lineupBPlayerIds: null,
    };
  }

  if ((teamA.members?.length ?? 0) < 1 || (teamB.members?.length ?? 0) < 1) {
    return {
      ok: false,
      errors: [
        error(
          'TEAM_EMPTY',
          'Cada time precisa de pelo menos um jogador para restaurar as escalações.'
        ),
      ],
      lineupAPlayerIds: null,
      lineupBPlayerIds: null,
    };
  }

  return {
    ok: true,
    errors: [],
    lineupAPlayerIds: teamA.members.map((member) => member.playerId),
    lineupBPlayerIds: teamB.members.map((member) => member.playerId),
  };
}

function validateLineupTeamAssignments(match, teams) {
  const errors = [];

  const checkSide = (lineup, field, opponentTeamId) => {
    for (const member of Array.isArray(lineup) ? lineup : []) {
      const playerId = member?.playerId;
      if (typeof playerId !== 'string' || playerId.trim().length === 0) continue;
      const base = playerBaseTeam(teams, playerId);
      if (!base) {
        errors.push(
          error(
            'LINEUP_PLAYER_WITHOUT_TEAM',
            'O jogador precisa pertencer a um time-base deste encontro.',
            { field, playerId }
          )
        );
      } else if (base.id === opponentTeamId) {
        errors.push(
          error(
            'LINEUP_PLAYER_FROM_OPPONENT',
            'Jogador do time adversário não pode atuar neste lado.',
            { field, playerId }
          )
        );
      }
    }
  };

  checkSide(match?.lineupA, 'lineupA', match?.teamBId);
  checkSide(match?.lineupB, 'lineupB', match?.teamAId);
  return errors;
}

export function describeMatchLineupDraft({
  lineupAPlayerIds,
  lineupBPlayerIds,
  match,
  teams,
  format,
  roster,
} = {}) {
  if (!Array.isArray(lineupAPlayerIds) || !Array.isArray(lineupBPlayerIds)) {
    return fail([error('LINEUP_INVALID', 'A escalação precisa ser uma lista de jogadores.')]);
  }

  const lineupA = membersFromIds(lineupAPlayerIds, roster, match?.lineupA, {
    refreshFromRoster: false,
  });
  const lineupB = membersFromIds(lineupBPlayerIds, roster, match?.lineupB, {
    refreshFromRoster: false,
  });
  const proposed = {
    teamAId: match?.teamAId,
    teamBId: match?.teamBId,
    lineupA,
    lineupB,
  };

  const matchResult = validateMatchLineups(proposed, format, teams, roster, {
    existingMemberIds: collectSessionSnapshotPlayerIds({ teams, rounds: [{ matches: [match] }] }),
  });
  const assignmentErrors = validateLineupTeamAssignments(proposed, teams);
  const errors = [...(matchResult.ok ? [] : matchResult.errors), ...assignmentErrors];
  if (errors.length > 0) return fail(errors);

  return { ok: true, errors: [], lineupA, lineupB };
}

function withUpdatedMatchLineups(session, roundId, matchId, lineupA, lineupB, now) {
  const clock = now ?? (() => new Date());
  return {
    ...session,
    format: {
      teamSize: session.format.teamSize,
      teamCount: session.format.teamCount,
    },
    teams: cloneTeams(session.teams),
    rounds: (session.rounds ?? []).map((round) => {
      if (round.id !== roundId) return round;
      return {
        ...round,
        matches: (round.matches ?? []).map((match) =>
          match.id === matchId
            ? {
                ...match,
                lineupA: cloneTeamMembers(lineupA),
                lineupB: cloneTeamMembers(lineupB),
              }
            : match
        ),
      };
    }),
    updatedAt: clock().toISOString(),
  };
}

export function setTeamSessionMatchLineups(
  document,
  sessionId,
  roundId,
  matchId,
  lineupAPlayerIds,
  lineupBPlayerIds,
  options = {}
) {
  const schemaError = requireV2Document(document);
  if (schemaError) return schemaError;

  const located = locateInProgressMatch(
    document,
    sessionId,
    roundId,
    matchId,
    LINEUP_LOCK_MESSAGES
  );
  if (!located.ok) return located;

  const proposed = describeMatchLineupDraft({
    lineupAPlayerIds,
    lineupBPlayerIds,
    match: located.match,
    teams: located.session.teams,
    format: located.session.format,
    roster: options.roster,
  });
  if (!proposed.ok) return proposed;

  const updatedSession = withUpdatedMatchLineups(
    located.session,
    roundId,
    matchId,
    proposed.lineupA,
    proposed.lineupB,
    options.now
  );

  return succeed({
    document: replaceSession(document, located.session.id, updatedSession),
    session: updatedSession,
  });
}

export function classifyLineupMember(member, teams, ownTeamId) {
  const teamIndex = playerBaseTeamIndex(teams, member?.playerId);
  const team = teamIndex >= 0 ? teams[teamIndex] : null;
  return {
    playerId: member?.playerId,
    playerName: member?.playerName,
    teamId: team?.id ?? null,
    teamIndex,
    isLoan: Boolean(team && team.id !== ownTeamId),
  };
}
