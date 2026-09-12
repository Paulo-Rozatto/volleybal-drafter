export const TEAM_SESSION_SCHEMA_VERSION = 2;
export const MIN_TEAM_SIZE = 2;
export const MAX_TEAM_SIZE = 6;
export const MIN_TEAM_COUNT = 2;

function ok() {
  return { ok: true, errors: [] };
}

function fail(errors) {
  return { ok: false, errors };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rosterIds(roster) {
  return new Set((roster ?? []).map((player) => player?.id).filter(Boolean));
}

function memberPlayerId(member) {
  return isNonEmptyId(member?.playerId) ? member.playerId : null;
}

function collectMemberIds(groups) {
  const ids = [];
  for (const group of groups ?? []) {
    for (const member of group?.members ?? []) {
      const id = memberPlayerId(member);
      if (id) ids.push(id);
    }
  }
  return ids;
}

export function cloneTeamMembers(members) {
  return (Array.isArray(members) ? members : []).map((member) => ({
    playerId: member?.playerId,
    playerName: member?.playerName,
  }));
}

/**
 * Copia os membros atuais dos times A e B para as escalações da partida.
 * Não completa times incompletos e não compartilha arrays/objetos mutáveis.
 *
 * @param {{ members?: Array<{ playerId?: unknown, playerName?: unknown }> } | null | undefined} teamA
 * @param {{ members?: Array<{ playerId?: unknown, playerName?: unknown }> } | null | undefined} teamB
 */
export function createInitialLineups(teamA, teamB) {
  return {
    lineupA: cloneTeamMembers(teamA?.members),
    lineupB: cloneTeamMembers(teamB?.members),
  };
}

export function cloneV2Team(team) {
  return {
    id: team?.id,
    members: cloneTeamMembers(team?.members),
  };
}

export function cloneV2Match(match) {
  return {
    id: match?.id,
    teamAId: match?.teamAId,
    teamBId: match?.teamBId,
    lineupA: cloneTeamMembers(match?.lineupA),
    lineupB: cloneTeamMembers(match?.lineupB),
    scoreA: match?.scoreA,
    scoreB: match?.scoreB,
  };
}

export function cloneV2Round(round) {
  return {
    id: round?.id,
    number: round?.number,
    byeTeamId: round?.byeTeamId ?? null,
    matches: (round?.matches ?? []).map(cloneV2Match),
  };
}

export function cloneV2Session(session) {
  return {
    id: session?.id,
    date: session?.date,
    name: session?.name ?? null,
    status: session?.status,
    createdAt: session?.createdAt,
    updatedAt: session?.updatedAt,
    format: {
      teamSize: session?.format?.teamSize,
      teamCount: session?.format?.teamCount,
    },
    teams: (session?.teams ?? []).map(cloneV2Team),
    rounds: (session?.rounds ?? []).map(cloneV2Round),
  };
}

export function cloneV2Document(document) {
  return {
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions: (document?.sessions ?? []).map(cloneV2Session),
  };
}

/**
 * @param {unknown} format
 */
export function validateFormat(format) {
  if (format == null) {
    return fail([error('FORMAT_REQUIRED', 'O formato do encontro é obrigatório.')]);
  }

  if (!isPlainObject(format)) {
    return fail([error('FORMAT_INVALID', 'O formato do encontro é inválido.')]);
  }

  const errors = [];
  const { teamSize, teamCount } = format;

  if (!Number.isInteger(teamSize) || teamSize < MIN_TEAM_SIZE || teamSize > MAX_TEAM_SIZE) {
    errors.push(
      error(
        'TEAM_SIZE_INVALID',
        `O tamanho do time deve ser um inteiro entre ${MIN_TEAM_SIZE} e ${MAX_TEAM_SIZE}.`,
        { field: 'teamSize' }
      )
    );
  }

  if (!Number.isInteger(teamCount) || teamCount < MIN_TEAM_COUNT) {
    errors.push(
      error(
        'TEAM_COUNT_INVALID',
        `A quantidade de times deve ser um inteiro maior ou igual a ${MIN_TEAM_COUNT}.`,
        { field: 'teamCount' }
      )
    );
  }

  return errors.length > 0 ? fail(errors) : ok();
}

export function validateTeamCount(teams, format) {
  const formatResult = validateFormat(format);
  if (!formatResult.ok) return formatResult;

  if (!Array.isArray(teams)) {
    return fail([error('TEAMS_NOT_ARRAY', 'Os times do encontro precisam ser uma lista.')]);
  }

  if (teams.length !== format.teamCount) {
    return fail([
      error(
        'TEAM_COUNT_MISMATCH',
        `O encontro deve ter exatamente ${format.teamCount} times.`,
        { expected: format.teamCount, actual: teams.length }
      ),
    ]);
  }

  return ok();
}

/**
 * @param {{ id?: unknown, members?: unknown }} team
 * @param {{ teamSize?: unknown }} format
 * @param {Array<{ id: string }>} [roster]
 * @param {Array<{ id?: unknown, members?: unknown }>} [otherTeams]
 */
export function validateTeam(team, format, roster = null, otherTeams = []) {
  const errors = [];
  const teamSize = format?.teamSize;

  if (!isNonEmptyId(team?.id)) {
    errors.push(error('TEAM_ID_INVALID', 'O time precisa de um ID válido.', { field: 'id' }));
  } else if (otherTeams.some((other) => other?.id === team.id)) {
    errors.push(
      error('TEAM_ID_DUPLICATE', 'Já existe um time com este ID neste encontro.', { field: 'id' })
    );
  }

  const members = team?.members;
  if (!Array.isArray(members)) {
    errors.push(error('TEAM_MEMBERS_NOT_ARRAY', 'Os integrantes do time precisam ser uma lista.'));
    return fail(errors);
  }

  if (Number.isInteger(teamSize) && members.length > teamSize) {
    errors.push(
      error(
        'TEAM_CAPACITY_EXCEEDED',
        `O time não pode ter mais de ${teamSize} jogadores.`,
        { field: 'members' }
      )
    );
  }

  const seenIds = new Set();
  const knownIds = rosterIds(roster);
  const takenIds = new Set(collectMemberIds(otherTeams));

  members.forEach((member, index) => {
    const playerId = memberPlayerId(member);
    if (!playerId) {
      errors.push(
        error('TEAM_PLAYER_ID_INVALID', 'Cada integrante do time precisa de um ID de jogador válido.', {
          field: `members[${index}].playerId`,
        })
      );
      return;
    }

    if (seenIds.has(playerId)) {
      errors.push(
        error('TEAM_DUPLICATE_PLAYER', 'O time não pode ter o mesmo jogador duas vezes.', {
          field: `members[${index}].playerId`,
          playerId,
        })
      );
    }
    seenIds.add(playerId);

    if (Array.isArray(roster) && !knownIds.has(playerId)) {
      errors.push(
        error('TEAM_PLAYER_NOT_FOUND', 'Jogador não encontrado no elenco.', {
          field: `members[${index}].playerId`,
          playerId,
        })
      );
    }

    if (takenIds.has(playerId)) {
      errors.push(
        error('TEAM_PLAYER_ALREADY_ASSIGNED', 'O jogador já participa de outro time neste encontro.', {
          field: `members[${index}].playerId`,
          playerId,
        })
      );
    }
  });

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * @param {unknown} teams
 * @param {unknown} format
 * @param {Array<{ id: string }>} [roster]
 */
export function validateSessionTeams(teams, format, roster = null) {
  const formatResult = validateFormat(format);
  if (!formatResult.ok) return formatResult;

  const countResult = validateTeamCount(teams, format);
  const errors = countResult.ok ? [] : [...countResult.errors];

  if (!Array.isArray(teams)) {
    return fail(errors.length > 0 ? errors : [error('TEAMS_NOT_ARRAY', 'Os times do encontro precisam ser uma lista.')]);
  }

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

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * @param {unknown} lineup
 * @param {{ teamSize?: unknown }} format
 * @param {Array<{ id: string }>} [roster]
 * @param {{ field?: string }} [options]
 */
export function validateLineup(lineup, format, roster = null, options = {}) {
  const field = options.field ?? 'lineup';
  const teamSize = format?.teamSize;
  const errors = [];

  if (!Array.isArray(lineup)) {
    return fail([
      error('LINEUP_INVALID', 'A escalação precisa ser uma lista de jogadores.', { field }),
    ]);
  }

  if (lineup.length === 0) {
    return fail([
      error('LINEUP_EMPTY', 'A escalação precisa ter pelo menos um jogador.', { field }),
    ]);
  }

  if (Number.isInteger(teamSize) && lineup.length > teamSize) {
    errors.push(
      error(
        'LINEUP_CAPACITY_EXCEEDED',
        `A escalação não pode ter mais de ${teamSize} jogadores.`,
        { field }
      )
    );
  }

  const seenIds = new Set();
  const knownIds = rosterIds(roster);

  lineup.forEach((member, index) => {
    const playerId = memberPlayerId(member);
    if (!playerId) {
      errors.push(
        error('LINEUP_PLAYER_ID_INVALID', 'Cada jogador da escalação precisa de um ID válido.', {
          field: `${field}[${index}].playerId`,
        })
      );
      return;
    }

    if (seenIds.has(playerId)) {
      errors.push(
        error('LINEUP_DUPLICATE_PLAYER', 'A escalação não pode ter o mesmo jogador duas vezes.', {
          field: `${field}[${index}].playerId`,
          playerId,
        })
      );
    }
    seenIds.add(playerId);

    if (Array.isArray(roster) && !knownIds.has(playerId)) {
      errors.push(
        error('LINEUP_PLAYER_NOT_FOUND', 'Jogador não encontrado no elenco.', {
          field: `${field}[${index}].playerId`,
          playerId,
        })
      );
    }
  });

  return errors.length > 0 ? fail(errors) : ok();
}

function teamExists(teams, teamId) {
  return (teams ?? []).some((team) => team?.id === teamId);
}

/**
 * @param {{
 *   teamAId?: unknown,
 *   teamBId?: unknown,
 *   lineupA?: unknown,
 *   lineupB?: unknown
 * }} match
 * @param {{ teamSize?: unknown }} format
 * @param {Array<{ id?: unknown }>} teams
 * @param {Array<{ id: string }>} [roster]
 */
export function validateMatchLineups(match, format, teams = [], roster = null) {
  const errors = [];

  if (!isNonEmptyId(match?.teamAId) || !isNonEmptyId(match?.teamBId)) {
    errors.push(error('MATCH_TEAM_ID_INVALID', 'A partida precisa referenciar dois times válidos.'));
  } else if (match.teamAId === match.teamBId) {
    errors.push(error('MATCH_SAME_TEAM', 'Uma partida não pode ter o mesmo time dos dois lados.'));
  } else {
    if (!teamExists(teams, match.teamAId)) {
      errors.push(
        error('MATCH_TEAM_NOT_FOUND', 'Time referenciado na partida não existe.', {
          field: 'teamAId',
          teamId: match.teamAId,
        })
      );
    }
    if (!teamExists(teams, match.teamBId)) {
      errors.push(
        error('MATCH_TEAM_NOT_FOUND', 'Time referenciado na partida não existe.', {
          field: 'teamBId',
          teamId: match.teamBId,
        })
      );
    }
  }

  const lineupAResult = validateLineup(match?.lineupA, format, roster, { field: 'lineupA' });
  const lineupBResult = validateLineup(match?.lineupB, format, roster, { field: 'lineupB' });
  if (!lineupAResult.ok) errors.push(...lineupAResult.errors);
  if (!lineupBResult.ok) errors.push(...lineupBResult.errors);

  const idsA = new Set((Array.isArray(match?.lineupA) ? match.lineupA : []).map(memberPlayerId).filter(Boolean));
  const idsB = new Set((Array.isArray(match?.lineupB) ? match.lineupB : []).map(memberPlayerId).filter(Boolean));
  for (const playerId of idsA) {
    if (idsB.has(playerId)) {
      errors.push(
        error('MATCH_PLAYER_BOTH_SIDES', 'O mesmo jogador não pode atuar nos dois lados da partida.', {
          playerId,
        })
      );
    }
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * @param {unknown} session
 * @param {Array<{ id: string }>} [roster]
 */
export function validateV2Session(session, roster = null) {
  if (!isPlainObject(session)) {
    return fail([error('SESSION_INVALID', 'A sessão do encontro é inválida.')]);
  }

  const errors = [];
  const formatResult = validateFormat(session.format);
  if (!formatResult.ok) errors.push(...formatResult.errors);

  const teamsResult = validateSessionTeams(session.teams, session.format, roster);
  if (!teamsResult.ok) {
    errors.push(
      ...teamsResult.errors.filter(
        (item) => !errors.some((existing) => existing.code === item.code && existing.field === item.field)
      )
    );
  }

  if (!Array.isArray(session.rounds)) {
    errors.push(error('ROUNDS_NOT_ARRAY', 'As rodadas do encontro precisam ser uma lista.'));
  } else {
    session.rounds.forEach((round, roundIndex) => {
      if (round?.byeTeamId != null && !teamExists(session.teams, round.byeTeamId)) {
        errors.push(
          error('BYE_TEAM_NOT_FOUND', 'O time de folga referenciado não existe.', {
            roundIndex,
            teamId: round.byeTeamId,
          })
        );
      }

      (round?.matches ?? []).forEach((match, matchIndex) => {
        const result = validateMatchLineups(match, session.format, session.teams, roster);
        if (!result.ok) {
          errors.push(
            ...result.errors.map((item) => ({
              ...item,
              roundIndex,
              matchIndex,
              matchId: match?.id,
            }))
          );
        }
      });
    });
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Validação estrutural de um documento já em schema 2.
 * Não exige `teams.length === format.teamCount`, para permitir rascunhos em construção.
 *
 * @param {unknown} document
 * @param {Array<{ id: string }>} [roster]
 */
export function validateV2Document(document, roster = null) {
  if (document == null) {
    return fail([error('DOCUMENT_REQUIRED', 'O documento de encontros é obrigatório.')]);
  }

  if (!isPlainObject(document)) {
    return fail([error('DOCUMENT_INVALID', 'O documento de encontros precisa ser um objeto.')]);
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

  if (!Object.prototype.hasOwnProperty.call(document, 'sessions') || !Array.isArray(document.sessions)) {
    return fail([error('SESSIONS_NOT_ARRAY', 'O documento de encontros precisa ter uma lista de sessões.')]);
  }

  const errors = [];
  document.sessions.forEach((session, sessionIndex) => {
    if (!isPlainObject(session)) {
      errors.push(
        error('SESSION_INVALID', 'A sessão do encontro é inválida.', { sessionIndex })
      );
      return;
    }

    const formatResult = validateFormat(session.format);
    if (!formatResult.ok) {
      errors.push(...formatResult.errors.map((item) => ({ ...item, sessionIndex, sessionId: session.id })));
    }

    if (!Array.isArray(session.teams)) {
      errors.push(
        error('TEAMS_NOT_ARRAY', 'Os times do encontro precisam ser uma lista.', {
          sessionIndex,
          sessionId: session.id,
        })
      );
    } else {
      session.teams.forEach((team, index) => {
        const otherTeams = session.teams.filter((_, otherIndex) => otherIndex !== index);
        const result = validateTeam(team, session.format, roster, otherTeams);
        if (!result.ok) {
          errors.push(
            ...result.errors.map((item) => ({
              ...item,
              sessionIndex,
              sessionId: session.id,
              teamIndex: index,
              teamId: team?.id,
            }))
          );
        }
      });
    }

    if (!Array.isArray(session.rounds)) {
      errors.push(
        error('ROUNDS_NOT_ARRAY', 'As rodadas do encontro precisam ser uma lista.', {
          sessionIndex,
          sessionId: session.id,
        })
      );
      return;
    }

    session.rounds.forEach((round, roundIndex) => {
      if (round?.byeTeamId != null && !teamExists(session.teams, round.byeTeamId)) {
        errors.push(
          error('BYE_TEAM_NOT_FOUND', 'O time de folga referenciado não existe.', {
            sessionIndex,
            roundIndex,
            teamId: round.byeTeamId,
          })
        );
      }

      (round?.matches ?? []).forEach((match, matchIndex) => {
        const result = validateMatchLineups(match, session.format, session.teams ?? [], roster);
        if (!result.ok) {
          errors.push(
            ...result.errors.map((item) => ({
              ...item,
              sessionIndex,
              sessionId: session.id,
              roundIndex,
              matchIndex,
              matchId: match?.id,
            }))
          );
        }
      });
    });
  });

  return errors.length > 0 ? fail(errors) : ok();
}
