import { validateCompetition, validateCompetitionDocument } from '../domain/competition.js';
import { collectSessionSnapshotPlayerIds, validateV2Document } from '../domain/teamSession.js';
import { migrateCompetitionsDocumentToV2 } from '../persistence/competitionsMigration.js';
import { createEmptyCompetitionDocument, interpretCompetitionsJson } from '../persistence/competitionsDocument.js';
import { GAME_SESSIONS_SCHEMA_VERSION, COMPETITION_SCHEMA_VERSION } from '../persistence/constants.js';
import { createEmptyGameSessionsDocument, interpretGameSessionsJson } from '../persistence/gameSessionsDocument.js';
import { migrateGameSessionsDocumentToV2 } from '../persistence/gameSessionsMigration.js';

export const LEGACY_IMPORT_STATUSES = Object.freeze([
  'NEW',
  'ALREADY_IMPORTED',
  'NEEDS_PLAYER_MAPPING',
  'INVALID_LEGACY_DATA',
  'CLOUD_ID_CONFLICT',
  'LEGACY_ID_CONFLICT',
  'UNSUPPORTED_SCHEMA',
  'IMPORT_FAILED',
  'NAME_COLLISION',
]);

export const PLAYER_DECISIONS = Object.freeze({
  CREATE_NEW: 'create_new',
  ASSOCIATE: 'associate',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCORE_VALUES = new Set([1, 2, 3, 4, 5]);
const GENDER_VALUES = new Set(['F', 'M']);
const HEIGHT_VALUES = new Set(['tall', 'short']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function fingerprintLegacySnapshot(snapshot) {
  const encoded = new TextEncoder().encode(canonicalJson(snapshot ?? {}));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function unsupported(kind, schemaVersion) {
  return {
    ok: false,
    code: 'UNSUPPORTED_SCHEMA',
    errors: [
      error(
        'UNSUPPORTED_SCHEMA',
        `Versão de schema de ${kind} não suportada: ${String(schemaVersion)}.`,
        { schemaVersion }
      ),
    ],
    document: null,
    sourceVersion: schemaVersion ?? null,
  };
}

export function normalizeLegacyPlayers(input) {
  if (input == null) return { ok: true, players: [], errors: [] };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      players: [],
      errors: [error('INVALID_LEGACY_DATA', 'players.json precisa conter um array.')],
    };
  }
  const players = [];
  const errors = [];
  const seen = new Set();
  for (const raw of input) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!id) {
      errors.push(error('INVALID_LEGACY_DATA', 'O jogador legado precisa de um ID.', { field: 'id' }));
      continue;
    }
    if (seen.has(id)) {
      errors.push(error('INVALID_LEGACY_DATA', 'Há jogadores legados com o mesmo ID.', { legacyId: id }));
      continue;
    }
    seen.add(id);
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) {
      errors.push(error('INVALID_LEGACY_DATA', 'O nome do jogador é obrigatório.', { legacyId: id }));
      continue;
    }
    const score = raw?.score;
    const gender = raw?.gender;
    const height = raw?.height || 'short';
    if (!SCORE_VALUES.has(score) || !GENDER_VALUES.has(gender) || !HEIGHT_VALUES.has(height)) {
      errors.push(error('INVALID_LEGACY_DATA', 'Dados do jogador legado são inválidos.', { legacyId: id }));
      continue;
    }
    players.push({ id, name, score, gender, height });
  }
  return { ok: errors.length === 0, players, errors };
}

export function normalizeLegacySessionsDocument(input) {
  if (input == null) {
    return { ok: true, document: createEmptyGameSessionsDocument(), sourceVersion: null, errors: [] };
  }
  if (typeof input === 'string') {
    try {
      const parsed = interpretGameSessionsJson(input);
      return {
        ok: true,
        document: parsed.document,
        sourceVersion: parsed.sourceVersion,
        migrated: parsed.migrated,
        errors: [],
      };
    } catch (caught) {
      const message = caught?.message || 'Documento de encontros inválido.';
      if (String(message).includes('não suportada')) {
        return unsupported('encontros', null);
      }
      return { ok: false, code: 'INVALID_LEGACY_DATA', errors: [error('INVALID_LEGACY_DATA', message)], document: null };
    }
  }
  if (!isPlainObject(input) || !Object.prototype.hasOwnProperty.call(input, 'schemaVersion')) {
    return {
      ok: false,
      code: 'INVALID_LEGACY_DATA',
      errors: [error('INVALID_LEGACY_DATA', 'O documento de encontros é inválido.')],
      document: null,
    };
  }
  if (input.schemaVersion !== 1 && input.schemaVersion !== GAME_SESSIONS_SCHEMA_VERSION) {
    return unsupported('encontros', input.schemaVersion);
  }
  const migrated = migrateGameSessionsDocumentToV2(input);
  if (!migrated.ok) {
    const code = migrated.errors?.[0]?.code === 'SCHEMA_VERSION_UNSUPPORTED' ? 'UNSUPPORTED_SCHEMA' : 'INVALID_LEGACY_DATA';
    return { ok: false, code, errors: migrated.errors, document: null, sourceVersion: input.schemaVersion };
  }
  const validation = validateV2Document(migrated.document);
  if (!validation.ok) {
    return { ok: false, code: 'INVALID_LEGACY_DATA', errors: validation.errors, document: null };
  }
  return {
    ok: true,
    document: migrated.document,
    sourceVersion: input.schemaVersion,
    migrated: Boolean(migrated.migrated),
    errors: [],
  };
}

export function normalizeLegacyCompetitionsDocument(input) {
  if (input == null) {
    return { ok: true, document: createEmptyCompetitionDocument(), sourceVersion: null, errors: [] };
  }
  if (typeof input === 'string') {
    try {
      const parsed = interpretCompetitionsJson(input);
      return {
        ok: true,
        document: parsed.document,
        sourceVersion: parsed.sourceVersion,
        migrated: parsed.migrated,
        errors: [],
      };
    } catch (caught) {
      const message = caught?.message || 'Documento de competições inválido.';
      if (String(message).includes('não suportada')) {
        return unsupported('competições', null);
      }
      return { ok: false, code: 'INVALID_LEGACY_DATA', errors: [error('INVALID_LEGACY_DATA', message)], document: null };
    }
  }
  if (!isPlainObject(input) || !Object.prototype.hasOwnProperty.call(input, 'schemaVersion')) {
    return {
      ok: false,
      code: 'INVALID_LEGACY_DATA',
      errors: [error('INVALID_LEGACY_DATA', 'O documento de competições é inválido.')],
      document: null,
    };
  }
  if (input.schemaVersion !== 1 && input.schemaVersion !== COMPETITION_SCHEMA_VERSION) {
    return unsupported('competições', input.schemaVersion);
  }
  const migrated = migrateCompetitionsDocumentToV2(input);
  if (!migrated.ok) {
    const code = migrated.errors?.[0]?.code === 'SCHEMA_VERSION_UNSUPPORTED' ? 'UNSUPPORTED_SCHEMA' : 'INVALID_LEGACY_DATA';
    return { ok: false, code, errors: migrated.errors, document: null, sourceVersion: input.schemaVersion };
  }
  const validation = validateCompetitionDocument(migrated.document);
  if (!validation.ok) {
    return { ok: false, code: 'INVALID_LEGACY_DATA', errors: validation.errors, document: null };
  }
  return {
    ok: true,
    document: migrated.document,
    sourceVersion: input.schemaVersion,
    migrated: Boolean(migrated.migrated),
    errors: [],
  };
}

function collectMemberPlayer(member, into) {
  const id = typeof member?.playerId === 'string' ? member.playerId.trim() : '';
  if (!id) return;
  const name = typeof member?.playerName === 'string' && member.playerName.trim()
    ? member.playerName.trim()
    : into.get(id)?.name ?? 'Jogador';
  if (!into.has(id)) into.set(id, { id, name, fromSnapshot: true });
}

export function collectLegacyPlayerRefs({ players = [], sessions = [], competitions = [] } = {}) {
  const byId = new Map();
  for (const player of players) {
    if (player?.id) byId.set(player.id, { ...player, fromSnapshot: false });
  }
  for (const session of sessions) {
    for (const team of session?.teams ?? []) {
      for (const member of team?.members ?? []) collectMemberPlayer(member, byId);
    }
    for (const id of collectSessionSnapshotPlayerIds(session) ?? []) {
      if (!byId.has(id)) byId.set(id, { id, name: 'Jogador', fromSnapshot: true });
    }
    for (const round of session?.rounds ?? []) {
      for (const match of round?.matches ?? []) {
        for (const member of [...(match?.lineupA ?? []), ...(match?.lineupB ?? [])]) {
          collectMemberPlayer(member, byId);
        }
      }
    }
  }
  for (const competition of competitions) {
    for (const team of competition?.teams ?? []) {
      for (const member of team?.members ?? []) collectMemberPlayer(member, byId);
    }
    for (const stage of competition?.stages ?? []) {
      for (const round of stage?.rounds ?? []) {
        for (const match of round?.matches ?? []) {
          for (const member of [...(match?.lineupA ?? []), ...(match?.lineupB ?? [])]) {
            collectMemberPlayer(member, byId);
          }
        }
      }
    }
  }
  return [...byId.values()];
}

function sameName(left, right) {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();
}

function sessionPlayerIds(session) {
  const ids = new Set();
  for (const team of session?.teams ?? []) {
    for (const member of team?.members ?? []) {
      if (member?.playerId) ids.add(member.playerId);
    }
  }
  for (const round of session?.rounds ?? []) {
    for (const match of round?.matches ?? []) {
      for (const member of [...(match?.lineupA ?? []), ...(match?.lineupB ?? [])]) {
        if (member?.playerId) ids.add(member.playerId);
      }
    }
  }
  return [...ids];
}

function competitionPlayerIds(competition) {
  const ids = new Set();
  for (const team of competition?.teams ?? []) {
    for (const member of team?.members ?? []) {
      if (member?.playerId) ids.add(member.playerId);
    }
  }
  for (const stage of competition?.stages ?? []) {
    for (const round of stage?.rounds ?? []) {
      for (const match of round?.matches ?? []) {
        for (const member of [...(match?.lineupA ?? []), ...(match?.lineupB ?? [])]) {
          if (member?.playerId) ids.add(member.playerId);
        }
      }
    }
  }
  return [...ids];
}

function countByStatus(items, status) {
  return items.filter((item) => item.status === status).length;
}

export function buildLegacyMigrationPlan({
  players = [],
  sessionsDocument,
  competitionsDocument,
  cloudState = {},
  playerDecisions = {},
} = {}) {
  const playerNorm = Array.isArray(players)
    ? normalizeLegacyPlayers(players)
    : { ok: false, players: [], errors: [error('INVALID_LEGACY_DATA', 'Elenco legado inválido.')] };
  const sessionsNorm = normalizeLegacySessionsDocument(sessionsDocument);
  const competitionsNorm = normalizeLegacyCompetitionsDocument(competitionsDocument);

  const schemaError =
    (!sessionsNorm.ok && sessionsNorm.code === 'UNSUPPORTED_SCHEMA' && sessionsNorm) ||
    (!competitionsNorm.ok && competitionsNorm.code === 'UNSUPPORTED_SCHEMA' && competitionsNorm) ||
    null;

  const mappings = new Map(
    (cloudState.playerMappings ?? []).map((row) => [row.legacy_player_id ?? row.legacyPlayerId, row])
  );
  const importedSessions = new Map(
    (cloudState.sessions ?? []).map((row) => [row.legacy_source_id ?? row.legacySourceId, row])
  );
  const importedCompetitions = new Map(
    (cloudState.competitions ?? []).map((row) => [row.legacy_source_id ?? row.legacySourceId, row])
  );
  const mappablePlayers = cloudState.mappablePlayers ?? [];

  const refs = collectLegacyPlayerRefs({
    players: playerNorm.players,
    sessions: sessionsNorm.document?.sessions ?? [],
    competitions: competitionsNorm.document?.competitions ?? [],
  });

  const playerItems = refs.map((player) => {
    const mapped = mappings.get(player.id);
    if (mapped) {
      return {
        entityType: 'player',
        legacyId: player.id,
        name: player.name,
        status: 'ALREADY_IMPORTED',
        cloudId: mapped.cloud_player_id ?? mapped.cloudPlayerId,
        player,
      };
    }
    const decision = playerDecisions[player.id];
    const collisions = mappablePlayers.filter((cloud) => sameName(cloud.name, player.name));
    if (decision?.action === PLAYER_DECISIONS.ASSOCIATE && decision.cloudPlayerId) {
      const target = mappablePlayers.find((cloud) => cloud.id === decision.cloudPlayerId);
      if (!target) {
        return {
          entityType: 'player',
          legacyId: player.id,
          name: player.name,
          status: 'NEEDS_PLAYER_MAPPING',
          errorCode: 'PLAYER_MAPPING_INVALID',
          collisions,
          player,
        };
      }
      return {
        entityType: 'player',
        legacyId: player.id,
        name: player.name,
        status: 'NEW',
        decision,
        collisions,
        player,
      };
    }
    if (decision?.action === PLAYER_DECISIONS.CREATE_NEW) {
      return {
        entityType: 'player',
        legacyId: player.id,
        name: player.name,
        status: 'NEW',
        decision,
        collisions,
        player,
      };
    }
    if (collisions.length > 0) {
      return {
        entityType: 'player',
        legacyId: player.id,
        name: player.name,
        status: 'NEEDS_PLAYER_MAPPING',
        collisions,
        player,
      };
    }
    return {
      entityType: 'player',
      legacyId: player.id,
      name: player.name,
      status: 'NEW',
      collisions,
      player,
    };
  });

  const mappedOrReady = new Set(
    playerItems
      .filter((item) => item.status === 'ALREADY_IMPORTED' || item.status === 'NEW')
      .map((item) => item.legacyId)
  );

  const sessionItems = (sessionsNorm.document?.sessions ?? []).map((session) => {
    const validation = validateV2Document({ schemaVersion: 2, sessions: [session] });
    if (!sessionsNorm.ok || !validation.ok) {
      return {
        entityType: 'session',
        legacyId: session?.id ?? '',
        name: session?.name ?? session?.date ?? 'Encontro',
        status: 'INVALID_LEGACY_DATA',
        errors: validation.errors ?? sessionsNorm.errors,
        session,
      };
    }
    const imported = importedSessions.get(session.id);
    if (imported) {
      return {
        entityType: 'session',
        legacyId: session.id,
        name: session.name ?? session.date,
        status: 'ALREADY_IMPORTED',
        cloudId: imported.id,
        session,
      };
    }
    const missingPlayers = sessionPlayerIds(session).filter((id) => !mappedOrReady.has(id));
    if (missingPlayers.length > 0) {
      return {
        entityType: 'session',
        legacyId: session.id,
        name: session.name ?? session.date,
        status: 'NEEDS_PLAYER_MAPPING',
        missingPlayers,
        session,
      };
    }
    return {
      entityType: 'session',
      legacyId: session.id,
      name: session.name ?? session.date,
      status: 'NEW',
      session,
    };
  });

  const competitionItems = (competitionsNorm.document?.competitions ?? []).map((competition) => {
    const validation = validateCompetition(competition);
    if (!competitionsNorm.ok || !validation.ok) {
      return {
        entityType: 'competition',
        legacyId: competition?.id ?? '',
        name: competition?.name ?? 'Competição',
        status: 'INVALID_LEGACY_DATA',
        errors: validation.errors ?? competitionsNorm.errors,
        competition,
      };
    }
    const imported = importedCompetitions.get(competition.id);
    if (imported) {
      return {
        entityType: 'competition',
        legacyId: competition.id,
        name: competition.name,
        status: 'ALREADY_IMPORTED',
        cloudId: imported.id,
        competition,
      };
    }
    const missingPlayers = competitionPlayerIds(competition).filter((id) => !mappedOrReady.has(id));
    if (missingPlayers.length > 0) {
      return {
        entityType: 'competition',
        legacyId: competition.id,
        name: competition.name,
        status: 'NEEDS_PLAYER_MAPPING',
        missingPlayers,
        competition,
      };
    }
    return {
      entityType: 'competition',
      legacyId: competition.id,
      name: competition.name,
      status: 'NEW',
      competition,
    };
  });

  const problems = [
    ...(playerNorm.ok ? [] : playerNorm.errors),
    ...(sessionsNorm.ok ? [] : sessionsNorm.errors ?? []),
    ...(competitionsNorm.ok ? [] : competitionsNorm.errors ?? []),
    ...playerItems.filter((item) => item.status !== 'NEW' && item.status !== 'ALREADY_IMPORTED'),
    ...sessionItems.filter((item) => item.status !== 'NEW' && item.status !== 'ALREADY_IMPORTED'),
    ...competitionItems.filter((item) => item.status !== 'NEW' && item.status !== 'ALREADY_IMPORTED'),
  ];

  return {
    ok: !schemaError && playerNorm.ok && sessionsNorm.ok && competitionsNorm.ok,
    schemaError,
    sourceVersions: {
      sessions: sessionsNorm.sourceVersion ?? null,
      competitions: competitionsNorm.sourceVersion ?? null,
    },
    players: playerItems,
    sessions: sessionItems,
    competitions: competitionItems,
    summary: {
      playersFound: playerItems.length,
      playersNew: countByStatus(playerItems, 'NEW'),
      playersNeedMapping: countByStatus(playerItems, 'NEEDS_PLAYER_MAPPING'),
      playersMapped: countByStatus(playerItems, 'ALREADY_IMPORTED'),
      sessionsFound: sessionItems.length,
      sessionsToImport: countByStatus(sessionItems, 'NEW'),
      sessionsImported: countByStatus(sessionItems, 'ALREADY_IMPORTED'),
      sessionsConflicts: sessionItems.filter((item) => item.status !== 'NEW' && item.status !== 'ALREADY_IMPORTED').length,
      competitionsFound: competitionItems.length,
      competitionsToImport: countByStatus(competitionItems, 'NEW'),
      competitionsImported: countByStatus(competitionItems, 'ALREADY_IMPORTED'),
      problems: problems.length,
    },
    problems,
    documents: {
      players: playerNorm.players,
      sessions: sessionsNorm.document,
      competitions: competitionsNorm.document,
    },
  };
}

function remapMembers(members, playerMap) {
  return (members ?? []).map((member) => ({
    ...member,
    playerId: playerMap.get(member.playerId) ?? member.playerId,
  }));
}

export function remapSessionPlayersForCompare(session, playerMap) {
  return {
    ...session,
    teams: (session?.teams ?? []).map((team) => ({
      ...team,
      members: remapMembers(team.members, playerMap),
    })),
    rounds: (session?.rounds ?? []).map((round) => ({
      ...round,
      matches: (round.matches ?? []).map((match) => ({
        ...match,
        lineupA: remapMembers(match.lineupA, playerMap),
        lineupB: remapMembers(match.lineupB, playerMap),
      })),
    })),
  };
}

export function remapCompetitionPlayersForCompare(competition, playerMap) {
  return {
    ...competition,
    teams: (competition?.teams ?? []).map((team) => ({
      ...team,
      members: remapMembers(team.members, playerMap),
    })),
    stages: (competition?.stages ?? []).map((stage) => ({
      ...stage,
      rounds: (stage.rounds ?? []).map((round) => ({
        ...round,
        matches: (round.matches ?? []).map((match) => ({
          ...match,
          lineupA: remapMembers(match.lineupA, playerMap),
          lineupB: remapMembers(match.lineupB, playerMap),
        })),
      })),
    })),
  };
}

export function verifyImportedSession(legacySession, cloudSession, playerMap) {
  const expected = remapSessionPlayersForCompare(legacySession, playerMap);
  const mismatches = [];
  if ((expected.teams ?? []).length !== (cloudSession?.teams ?? []).length) {
    mismatches.push('teams');
  }
  if ((expected.rounds ?? []).length !== (cloudSession?.rounds ?? []).length) {
    mismatches.push('rounds');
  }
  const expectedMatches = (expected.rounds ?? []).flatMap((round) => round.matches ?? []);
  const cloudMatches = (cloudSession?.rounds ?? []).flatMap((round) => round.matches ?? []);
  if (expectedMatches.length !== cloudMatches.length) mismatches.push('matches');
  const scorePairs = expectedMatches.map((match) => `${match.scoreA ?? ''}:${match.scoreB ?? ''}`).sort();
  const cloudScores = cloudMatches.map((match) => `${match.scoreA ?? ''}:${match.scoreB ?? ''}`).sort();
  if (scorePairs.join('|') !== cloudScores.join('|')) mismatches.push('scores');
  if (expected.status !== cloudSession?.status) mismatches.push('status');
  if (cloudSession?.groupId) mismatches.push('group_id');
  return { ok: mismatches.length === 0, mismatches };
}

export function verifyImportedCompetition(legacyCompetition, cloudCompetition, playerMap) {
  const expected = remapCompetitionPlayersForCompare(legacyCompetition, playerMap);
  const mismatches = [];
  if ((expected.teams ?? []).length !== (cloudCompetition?.teams ?? []).length) mismatches.push('teams');
  if ((expected.stages ?? []).length !== (cloudCompetition?.stages ?? []).length) mismatches.push('stages');
  const expectedMatches = (expected.stages ?? []).flatMap((stage) =>
    (stage.rounds ?? []).flatMap((round) => round.matches ?? [])
  );
  const cloudMatches = (cloudCompetition?.stages ?? []).flatMap((stage) =>
    (stage.rounds ?? []).flatMap((round) => round.matches ?? [])
  );
  if (expectedMatches.length !== cloudMatches.length) mismatches.push('matches');
  const scorePairs = expectedMatches.map((match) => `${match.scoreA ?? ''}:${match.scoreB ?? ''}`).sort();
  const cloudScores = cloudMatches.map((match) => `${match.scoreA ?? ''}:${match.scoreB ?? ''}`).sort();
  if (scorePairs.join('|') !== cloudScores.join('|')) mismatches.push('scores');
  if (expected.status !== cloudCompetition?.status) mismatches.push('status');
  return { ok: mismatches.length === 0, mismatches };
}

export function serializeLegacySnapshot({ players, sessions, competitions }) {
  return JSON.stringify(
    {
      players: players ?? [],
      sessions: sessions ?? createEmptyGameSessionsDocument(),
      competitions: competitions ?? createEmptyCompetitionDocument(),
    },
    null,
    2
  );
}

export function parseLegacySnapshotJson(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('JSON inválido no snapshot legado.');
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('O snapshot legado precisa ser um objeto.');
  }
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  const sessionsSource = parsed.sessions ?? parsed.gameSessions ?? parsed;
  const competitionsSource = parsed.competitions;
  const sessions = interpretGameSessionsJson(
    typeof sessionsSource === 'string' ? sessionsSource : JSON.stringify(sessionsSource)
  );
  const competitions = interpretCompetitionsJson(
    competitionsSource == null
      ? ''
      : typeof competitionsSource === 'string'
        ? competitionsSource
        : JSON.stringify(competitionsSource)
  );
  return {
    players,
    sessions: sessions.document,
    competitions: competitions.document,
    sessionsMigrated: Boolean(sessions.migrated),
    competitionsMigrated: Boolean(competitions.migrated),
  };
}

export function summarizeImportReport(results = []) {
  return {
    imported: results.filter((item) => item.status === 'imported' || item.status === 'ALREADY_IMPORTED' || item.status === 'already_imported').length,
    failed: results.filter((item) => item.ok === false || item.status === 'IMPORT_FAILED' || item.status === 'failed').length,
    items: results,
  };
}
