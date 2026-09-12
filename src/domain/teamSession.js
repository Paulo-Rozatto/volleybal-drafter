import { validateCanFinalize, validateDate, validateScore } from './sessionValidation.js';

export const TEAM_SESSION_SCHEMA_VERSION = 2;
export const MIN_TEAM_SIZE = 2;
export const MAX_TEAM_SIZE = 6;
export const MIN_TEAM_COUNT = 2;
export const SESSION_STATUSES = Object.freeze(['draft', 'in_progress', 'finished']);

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

const SESSION_STATUS_SET = new Set(SESSION_STATUSES);
const LEGACY_PAIR_KEYS = new Set(['pairs', 'pairAId', 'pairBId', 'byePairId']);

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return Number.isFinite(Date.parse(value));
}

function countSessionMatchEntries(session) {
  if (!Array.isArray(session?.rounds)) return 0;
  return session.rounds.reduce(
    (total, round) => total + (Array.isArray(round?.matches) ? round.matches.length : 0),
    0
  );
}

function collectLegacyPairKeys(value, found = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectLegacyPairKeys(item, found));
    return found;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (LEGACY_PAIR_KEYS.has(key)) found.add(key);
      collectLegacyPairKeys(child, found);
    }
  }

  return found;
}

function collectSessionIntegrityErrors(session, { roster = null, sessionIndex = 0, seenSessionIds, requireExactTeamCount = false } = {}) {
  const errors = [];
  const sessionId = session?.id;
  const context = { sessionIndex, sessionId };

  const legacy = collectLegacyPairKeys(session);
  if (legacy.size > 0) {
    errors.push(
      error(
        'DOCUMENT_HYBRID',
        `Documento de encontros híbrido ou V1 não pode ser salvo (${[...legacy].join(', ')}).`,
        context
      )
    );
  }

  if (!isNonEmptyId(sessionId)) {
    errors.push(error('SESSION_ID_INVALID', 'A sessão precisa de um ID válido.', { ...context, field: 'id' }));
  } else if (seenSessionIds) {
    if (seenSessionIds.has(sessionId)) {
      errors.push(
        error('SESSION_ID_DUPLICATE', 'Já existe uma sessão com este ID no documento.', {
          ...context,
          field: 'id',
        })
      );
    } else {
      seenSessionIds.add(sessionId);
    }
  }

  const dateResult = validateDate(session?.date);
  if (!dateResult.ok) {
    errors.push(...dateResult.errors.map((item) => ({ ...item, ...context })));
  }

  if (session?.name != null && typeof session.name !== 'string') {
    errors.push(
      error('SESSION_NAME_INVALID', 'O nome do encontro precisa ser um texto ou vazio.', {
        ...context,
        field: 'name',
      })
    );
  }

  if (!SESSION_STATUS_SET.has(session?.status)) {
    errors.push(
      error(
        'SESSION_STATUS_INVALID',
        'O status do encontro precisa ser rascunho, em andamento ou finalizado.',
        { ...context, field: 'status', status: session?.status }
      )
    );
  }

  if (!isIsoTimestamp(session?.createdAt)) {
    errors.push(
      error('CREATED_AT_INVALID', 'A data de criação do encontro é inválida.', {
        ...context,
        field: 'createdAt',
      })
    );
  }

  if (!isIsoTimestamp(session?.updatedAt)) {
    errors.push(
      error('UPDATED_AT_INVALID', 'A data de atualização do encontro é inválida.', {
        ...context,
        field: 'updatedAt',
      })
    );
  }

  const formatResult = validateFormat(session?.format);
  if (!formatResult.ok) {
    errors.push(...formatResult.errors.map((item) => ({ ...item, ...context })));
  }

  if (!Array.isArray(session?.teams)) {
    errors.push(
      error('TEAMS_NOT_ARRAY', 'Os times do encontro precisam ser uma lista.', context)
    );
  } else if (requireExactTeamCount) {
    const teamsResult = validateSessionTeams(session.teams, session.format, roster);
    if (!teamsResult.ok) {
      errors.push(...teamsResult.errors.map((item) => ({ ...item, ...context })));
    }
  } else {
    session.teams.forEach((team, index) => {
      const otherTeams = session.teams.filter((_, otherIndex) => otherIndex !== index);
      const result = validateTeam(team, session.format, roster, otherTeams);
      if (!result.ok) {
        errors.push(
          ...result.errors.map((item) => ({
            ...item,
            ...context,
            teamIndex: index,
            teamId: team?.id,
          }))
        );
      }
    });
  }

  if (!Array.isArray(session?.rounds)) {
    errors.push(error('ROUNDS_NOT_ARRAY', 'As rodadas do encontro precisam ser uma lista.', context));
    return errors;
  }

  if (session.status === 'draft' && session.rounds.length > 0) {
    errors.push(
      error('DRAFT_HAS_ROUNDS', 'Um rascunho não pode ter rodadas.', context)
    );
  }

  if (session.status === 'in_progress' && countSessionMatchEntries(session) < 1) {
    errors.push(
      error(
        'IN_PROGRESS_NO_MATCHES',
        'Um encontro em andamento precisa ter pelo menos uma partida.',
        context
      )
    );
  }

  if (session.status === 'finished') {
    const finalizeResult = validateCanFinalize(session);
    if (!finalizeResult.ok) {
      errors.push(...finalizeResult.errors.map((item) => ({ ...item, ...context })));
    }
  }

  const seenRoundIds = new Set();
  const seenMatchIds = new Set();
  const seenRoundNumbers = new Set();

  session.rounds.forEach((round, roundIndex) => {
    if (!isPlainObject(round)) {
      errors.push(
        error('ROUND_INVALID', 'A rodada do encontro é inválida.', { ...context, roundIndex })
      );
      return;
    }

    if (!isNonEmptyId(round.id)) {
      errors.push(
        error('ROUND_ID_INVALID', 'A rodada precisa de um ID válido.', {
          ...context,
          roundIndex,
          field: 'id',
        })
      );
    } else if (seenRoundIds.has(round.id)) {
      errors.push(
        error('ROUND_ID_DUPLICATE', 'Já existe uma rodada com este ID neste encontro.', {
          ...context,
          roundIndex,
          roundId: round.id,
        })
      );
    } else {
      seenRoundIds.add(round.id);
    }

    if (!Number.isInteger(round.number) || round.number < 1) {
      errors.push(
        error('ROUND_NUMBER_INVALID', 'O número da rodada precisa ser um inteiro positivo.', {
          ...context,
          roundIndex,
          field: 'number',
        })
      );
    } else if (seenRoundNumbers.has(round.number)) {
      errors.push(
        error('ROUND_NUMBER_DUPLICATE', 'Já existe uma rodada com este número neste encontro.', {
          ...context,
          roundIndex,
          number: round.number,
        })
      );
    } else {
      seenRoundNumbers.add(round.number);
    }

    if (round.byeTeamId != null && !teamExists(session.teams, round.byeTeamId)) {
      errors.push(
        error('BYE_TEAM_NOT_FOUND', 'O time de folga referenciado não existe.', {
          ...context,
          roundIndex,
          teamId: round.byeTeamId,
        })
      );
    }

    if (!Array.isArray(round.matches)) {
      errors.push(
        error('MATCHES_NOT_ARRAY', 'As partidas da rodada precisam ser uma lista.', {
          ...context,
          roundIndex,
        })
      );
      return;
    }

    round.matches.forEach((match, matchIndex) => {
      if (!isPlainObject(match)) {
        errors.push(
          error('MATCH_INVALID', 'A partida do encontro é inválida.', {
            ...context,
            roundIndex,
            matchIndex,
          })
        );
        return;
      }

      if (!isNonEmptyId(match.id)) {
        errors.push(
          error('MATCH_ID_INVALID', 'A partida precisa de um ID válido.', {
            ...context,
            roundIndex,
            matchIndex,
            field: 'id',
          })
        );
      } else if (seenMatchIds.has(match.id)) {
        errors.push(
          error('MATCH_ID_DUPLICATE', 'Já existe uma partida com este ID neste encontro.', {
            ...context,
            roundIndex,
            matchIndex,
            matchId: match.id,
          })
        );
      } else {
        seenMatchIds.add(match.id);
      }

      const lineupResult = validateMatchLineups(match, session.format, session.teams ?? [], roster);
      if (!lineupResult.ok) {
        errors.push(
          ...lineupResult.errors.map((item) => ({
            ...item,
            ...context,
            roundIndex,
            matchIndex,
            matchId: match.id,
          }))
        );
      }

      const scoreResult = validateScore(match.scoreA, match.scoreB);
      if (!scoreResult.ok) {
        errors.push(
          ...scoreResult.errors.map((item) => ({
            ...item,
            ...context,
            roundIndex,
            matchIndex,
            matchId: match.id,
          }))
        );
      }
    });
  });

  for (const roundId of seenRoundIds) {
    if (seenMatchIds.has(roundId)) {
      errors.push(
        error(
          'ROUND_MATCH_ID_COLLISION',
          'O ID da rodada não pode coincidir com o ID de uma partida.',
          { ...context, id: roundId }
        )
      );
    }
  }

  return errors;
}

/**
 * @param {unknown} session
 * @param {Array<{ id: string }>} [roster]
 */
export function validateV2Session(session, roster = null) {
  if (!isPlainObject(session)) {
    return fail([error('SESSION_INVALID', 'A sessão do encontro é inválida.')]);
  }

  const errors = collectSessionIntegrityErrors(session, {
    roster,
    sessionIndex: 0,
    requireExactTeamCount: true,
  });
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
  const seenSessionIds = new Set();
  document.sessions.forEach((session, sessionIndex) => {
    if (!isPlainObject(session)) {
      errors.push(error('SESSION_INVALID', 'A sessão do encontro é inválida.', { sessionIndex }));
      return;
    }

    errors.push(
      ...collectSessionIntegrityErrors(session, {
        roster,
        sessionIndex,
        seenSessionIds,
        requireExactTeamCount: false,
      })
    );
  });

  return errors.length > 0 ? fail(errors) : ok();
}
