import {
  TEAM_SESSION_SCHEMA_VERSION,
  cloneV2Document,
  createInitialLineups,
  validateV2Document,
} from '../domain/teamSession.js';

function ok(document) {
  return { ok: true, errors: [], document };
}

function fail(errors) {
  return { ok: false, errors, document: null };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function inspectDocument(document) {
  if (document == null) {
    return fail([error('DOCUMENT_REQUIRED', 'O documento de encontros é obrigatório.')]);
  }

  if (!isPlainObject(document)) {
    return fail([error('DOCUMENT_INVALID', 'O documento de encontros precisa ser um objeto.')]);
  }

  if (!Object.prototype.hasOwnProperty.call(document, 'schemaVersion')) {
    return fail([error('SCHEMA_VERSION_REQUIRED', 'A versão do schema é obrigatória.')]);
  }

  const { schemaVersion } = document;
  if (schemaVersion !== 1 && schemaVersion !== TEAM_SESSION_SCHEMA_VERSION) {
    return fail([
      error(
        'SCHEMA_VERSION_UNSUPPORTED',
        `Versão de schema de encontros não suportada: ${String(schemaVersion)}.`,
        { schemaVersion }
      ),
    ]);
  }

  if (!Object.prototype.hasOwnProperty.call(document, 'sessions') || !Array.isArray(document.sessions)) {
    return fail([error('SESSIONS_NOT_ARRAY', 'O documento de encontros precisa ter uma lista de sessões.')]);
  }

  return { ok: true, errors: [], schemaVersion, sessions: document.sessions };
}

function findPair(pairs, pairId) {
  return (pairs ?? []).find((pair) => pair?.id === pairId) ?? null;
}

function migrateV1Session(session, sessionIndex) {
  if (!isPlainObject(session)) {
    return fail([
      error('SESSION_INVALID', 'A sessão do encontro é inválida.', { sessionIndex }),
    ]);
  }

  const pairs = Array.isArray(session.pairs) ? session.pairs : [];
  const rounds = Array.isArray(session.rounds) ? session.rounds : [];
  const errors = [];

  const teams = pairs.map((pair) => ({
    id: pair?.id,
    members: (pair?.members ?? []).map((member) => ({
      playerId: member?.playerId,
      playerName: member?.playerName,
    })),
  }));

  const migratedRounds = rounds.map((round, roundIndex) => {
    const byePairId = round?.byePairId ?? null;
    if (byePairId != null && !findPair(pairs, byePairId)) {
      errors.push(
        error('MIGRATION_PAIR_NOT_FOUND', 'Não é possível migrar uma referência a uma dupla inexistente.', {
          sessionIndex,
          sessionId: session.id,
          roundIndex,
          pairId: byePairId,
          field: 'byePairId',
        })
      );
    }

    const matches = (round?.matches ?? []).map((match, matchIndex) => {
      const pairA = findPair(pairs, match?.pairAId);
      const pairB = findPair(pairs, match?.pairBId);

      if (!pairA || !pairB) {
        errors.push(
          error('MIGRATION_PAIR_NOT_FOUND', 'Não é possível migrar uma referência a uma dupla inexistente.', {
            sessionIndex,
            sessionId: session.id,
            roundIndex,
            matchIndex,
            matchId: match?.id,
            pairAId: match?.pairAId,
            pairBId: match?.pairBId,
          })
        );
      }

      const { lineupA, lineupB } = createInitialLineups(pairA, pairB);
      return {
        id: match?.id,
        teamAId: match?.pairAId,
        teamBId: match?.pairBId,
        lineupA,
        lineupB,
        scoreA: match?.scoreA,
        scoreB: match?.scoreB,
      };
    });

    return {
      id: round?.id,
      number: round?.number,
      byeTeamId: byePairId,
      matches,
    };
  });

  if (errors.length > 0) return fail(errors);

  return ok({
    id: session.id,
    date: session.date,
    name: session.name ?? null,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    format: {
      teamSize: 2,
      teamCount: Math.max(2, pairs.length),
    },
    teams,
    rounds: migratedRounds,
  });
}

/**
 * Converte um documento V1 para V2 ou devolve uma cópia independente de um V2 válido.
 * Não muta a entrada e não faz fallback para documento vazio.
 *
 * @param {unknown} document
 * @returns {{ ok: boolean, errors: Array<{ code: string, message: string }>, document: object | null }}
 */
export function migrateGameSessionsDocumentToV2(document) {
  const inspected = inspectDocument(document);
  if (!inspected.ok) return inspected;

  if (inspected.schemaVersion === TEAM_SESSION_SCHEMA_VERSION) {
    const validation = validateV2Document(document);
    if (!validation.ok) return fail(validation.errors);
    return ok(cloneV2Document(document));
  }

  const errors = [];
  const sessions = [];

  inspected.sessions.forEach((session, sessionIndex) => {
    const migrated = migrateV1Session(session, sessionIndex);
    if (!migrated.ok) {
      errors.push(...migrated.errors);
      return;
    }
    sessions.push(migrated.document);
  });

  if (errors.length > 0) return fail(errors);

  return ok({
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions,
  });
}
