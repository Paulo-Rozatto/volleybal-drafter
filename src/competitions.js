import {
  COMPETITION_SCHEMA_VERSION,
  cloneCompetition,
  cloneCompetitionDocument,
  createDraftCompetition,
  createEmptyCompetitionDocument,
  applyCompetitionMatchResult,
  clearCompetitionMatchResult,
  generateCompetitionBracket as generateCompetitionBracketOnCompetition,
  setDraftCompetitionTeams,
  validateCompetitionDocument,
} from './domain/competition.js';

export {
  COMPETITION_DOWNSTREAM_CONFIRMATION_MESSAGE,
  COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED,
  CLEAR_COMPETITION_RESULT_CONFIRMATION_MESSAGE,
  CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED,
  GENERATE_BRACKET_CONFIRMATION_MESSAGE,
  GENERATE_BRACKET_CONFIRMATION_REQUIRED,
  getCompetitionChampion,
  isCompetitionFinished,
} from './domain/competition.js';

function fail(errors) {
  return { ok: false, errors, document: null, competition: null };
}

function succeed({ document, competition }) {
  return { ok: true, errors: [], document, competition };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function requireDocument(document) {
  const result = validateCompetitionDocument(document ?? createEmptyCompetitionDocument());
  if (!result.ok) return fail(result.errors);
  return null;
}

function findCompetition(document, competitionId) {
  return (document?.competitions ?? []).find((item) => item?.id === competitionId) ?? null;
}

function replaceCompetition(document, nextCompetition) {
  const competitions = Array.isArray(document?.competitions) ? document.competitions : [];
  return {
    schemaVersion: COMPETITION_SCHEMA_VERSION,
    competitions: competitions.map((item) =>
      item?.id === nextCompetition.id ? nextCompetition : item
    ),
  };
}

function withUpdatedAt(competition, now) {
  const next = cloneCompetition(competition);
  const clock = typeof now === 'function' ? now : () => new Date();
  next.updatedAt = clock().toISOString();
  return next;
}

export function appendDraftCompetition(document, input, options) {
  const schemaError = requireDocument(document ?? createEmptyCompetitionDocument());
  if (schemaError) return schemaError;

  let competition;
  try {
    competition = createDraftCompetition(input, options);
  } catch (caught) {
    return fail([error('COMPETITION_CREATE_INVALID', caught.message)]);
  }

  const current = Array.isArray(document?.competitions) ? document.competitions : [];
  return succeed({
    document: {
      schemaVersion: COMPETITION_SCHEMA_VERSION,
      competitions: [...current, competition],
    },
    competition,
  });
}

export function replaceCompetitionTeams(document, competitionId, teams, options = {}) {
  const schemaError = requireDocument(document);
  if (schemaError) return schemaError;

  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }

  const result = setDraftCompetitionTeams(current, teams, options);
  if (!result.ok) return fail(result.errors);

  const competition = withUpdatedAt(result.competition, options.now);
  return succeed({
    document: replaceCompetition(document, competition),
    competition,
  });
}

export function generateCompetitionBracket(document, competitionId, options = {}) {
  const schemaError = requireDocument(document);
  if (schemaError) return schemaError;

  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }

  const result = generateCompetitionBracketOnCompetition(current, options);
  if (!result.ok) return fail(result.errors);

  const competition = withUpdatedAt(result.competition, options.now);
  return succeed({
    document: replaceCompetition(document, competition),
    competition,
  });
}

export function setCompetitionMatchScore(
  document,
  competitionId,
  matchId,
  scores,
  options = {}
) {
  const schemaError = requireDocument(document);
  if (schemaError) return schemaError;

  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }

  const result = applyCompetitionMatchResult(current, matchId, scores, options);
  if (!result.ok) return fail(result.errors);

  const competition = withUpdatedAt(result.competition, options.now);
  return succeed({
    document: replaceCompetition(document, competition),
    competition,
  });
}

export function clearCompetitionMatchScore(document, competitionId, matchId, options = {}) {
  const schemaError = requireDocument(document);
  if (schemaError) return schemaError;

  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }

  const result = clearCompetitionMatchResult(current, matchId, options);
  if (!result.ok) return fail(result.errors);

  if (result.unchanged) {
    return { ok: true, errors: [], document: cloneCompetitionDocument(document), competition: current, unchanged: true };
  }

  const competition = withUpdatedAt(result.competition, options.now);
  return succeed({
    document: replaceCompetition(document, competition),
    competition,
  });
}

export function getCompetitionFromDocument(document, competitionId) {
  return findCompetition(document, competitionId);
}

function snapshotMember(player) {
  return {
    playerId: player?.id,
    playerName: typeof player?.name === 'string' ? player.name.trim() : '',
  };
}

function membersFromIds(memberIds, roster, previousMembers = []) {
  const byId = new Map((roster ?? []).map((player) => [player?.id, player]));
  const previousById = new Map(
    (previousMembers ?? [])
      .filter((member) => typeof member?.playerId === 'string' && member.playerId.trim())
      .map((member) => [member.playerId, member])
  );
  return (memberIds ?? []).map((id) => {
    const player = byId.get(id);
    if (player) return snapshotMember(player);
    const previous = previousById.get(id);
    if (previous) {
      return {
        playerId: previous.playerId,
        playerName: previous.playerName,
      };
    }
    return { playerId: id, playerName: '' };
  });
}

export function addCompetitionTeam(document, competitionId, memberIds = [], options = {}) {
  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }
  const team = {
    id: options.idGenerator ? options.idGenerator() : undefined,
    members: membersFromIds(memberIds, options.roster),
  };
  return replaceCompetitionTeams(document, competitionId, [...(current.teams ?? []), team], options);
}

export function updateCompetitionTeam(document, competitionId, teamId, memberIds = [], options = {}) {
  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }
  const teamIndex = (current.teams ?? []).findIndex((team) => team?.id === teamId);
  if (teamIndex < 0) {
    return fail([error('COMPETITION_TEAM_NOT_FOUND', 'Time não encontrado.')]);
  }
  const nextTeams = (current.teams ?? []).map((team, index) =>
    index === teamIndex
      ? {
          id: teamId,
          members: membersFromIds(memberIds, options.roster, team.members),
        }
      : team
  );
  return replaceCompetitionTeams(document, competitionId, nextTeams, options);
}

export function removeCompetitionTeam(document, competitionId, teamId, options = {}) {
  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }
  return replaceCompetitionTeams(
    document,
    competitionId,
    (current.teams ?? []).filter((team) => team?.id !== teamId),
    options
  );
}

export function moveCompetitionTeam(document, competitionId, teamId, delta, options = {}) {
  const current = findCompetition(document, competitionId);
  if (!current) {
    return fail([error('COMPETITION_NOT_FOUND', 'Competição não encontrada.')]);
  }
  const index = (current.teams ?? []).findIndex((team) => team?.id === teamId);
  if (index < 0) {
    return fail([error('COMPETITION_TEAM_NOT_FOUND', 'Time não encontrado.')]);
  }
  const nextTeams = [...(current.teams ?? [])];
  const target = index + Number(delta);
  if (target < 0 || target >= nextTeams.length) {
    return succeed({ document: cloneCompetitionDocument(document), competition: current });
  }
  const [team] = nextTeams.splice(index, 1);
  nextTeams.splice(target, 0, team);
  return replaceCompetitionTeams(document, competitionId, nextTeams, options);
}
