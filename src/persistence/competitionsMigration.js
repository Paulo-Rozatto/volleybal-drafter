import { COMPETITION_SCHEMA_VERSION, cloneCompetitionDocument } from '../domain/competition.js';
import { cloneCompetitionRound, stageNameForType } from '../domain/competitionPrimitives.js';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function migrateCompetitionV1(competition) {
  const type = competition?.tournamentType === 'single_elimination' ? 'single_elimination' : 'single_elimination';
  const rounds = (competition?.rounds ?? []).map((round) => ({
    ...cloneCompetitionRound(round),
    bracket: round?.bracket ?? 'winners',
    byes: Array.isArray(round?.byes) ? round.byes.map((bye) => ({ teamId: bye?.teamId ?? null })) : [],
  }));
  const seedTeamIds = Array.isArray(competition?.seedTeamIds)
    ? [...competition.seedTeamIds]
    : (competition?.teams ?? []).map((team) => team.id);
  const hasRounds = rounds.length > 0;
  let status = 'pending';
  if (competition?.status === 'finished' && hasRounds) status = 'finished';
  else if (hasRounds) status = 'in_progress';

  const next = {
    id: competition?.id,
    name: competition?.name ?? null,
    status: competition?.status,
    createdAt: competition?.createdAt,
    updatedAt: competition?.updatedAt,
    format: {
      teamSize: competition?.format?.teamSize,
    },
    seedTeamIds,
    teams: (competition?.teams ?? []).map((team) => ({
      id: team?.id,
      members: (team?.members ?? []).map((member) => ({
        playerId: member?.playerId,
        playerName: member?.playerName,
      })),
    })),
    stages: [
      {
        id: `${competition?.id || 'competition'}-stage-1`,
        number: 1,
        name: stageNameForType(type),
        type,
        status,
        config: {},
        seedTeamIds,
        seedSnapshot: null,
        rounds,
      },
    ],
  };
  if (typeof competition?.date === 'string') next.date = competition.date;
  return next;
}

export function migrateCompetitionsDocumentToV2(document) {
  if (!isPlainObject(document)) {
    return {
      ok: false,
      errors: [error('COMPETITION_DOCUMENT_INVALID', 'O documento de competições precisa ser um objeto.')],
      document: null,
      migrated: false,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(document, 'schemaVersion')) {
    return {
      ok: false,
      errors: [error('SCHEMA_VERSION_REQUIRED', 'A versão do schema é obrigatória.')],
      document: null,
      migrated: false,
    };
  }

  if (document.schemaVersion === COMPETITION_SCHEMA_VERSION) {
    return {
      ok: true,
      errors: [],
      document: cloneCompetitionDocument(document),
      migrated: false,
    };
  }

  if (document.schemaVersion !== 1) {
    return {
      ok: false,
      errors: [
        error(
          'SCHEMA_VERSION_UNSUPPORTED',
          `Versão de schema de competições não suportada: ${String(document.schemaVersion)}.`
        ),
      ],
      document: null,
      migrated: false,
    };
  }

  if (!Array.isArray(document.competitions)) {
    return {
      ok: false,
      errors: [error('COMPETITIONS_INVALID', 'O documento precisa ter uma lista de competições.')],
      document: null,
      migrated: false,
    };
  }

  return {
    ok: true,
    errors: [],
    migrated: true,
    document: {
      schemaVersion: COMPETITION_SCHEMA_VERSION,
      competitions: document.competitions.map(migrateCompetitionV1),
    },
  };
}
