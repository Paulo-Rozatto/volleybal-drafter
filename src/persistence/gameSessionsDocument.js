import { GAME_SESSIONS_SCHEMA_VERSION } from './constants.js';
import {
  cloneV2Document,
  TEAM_SESSION_SCHEMA_VERSION,
  validateV2Document,
} from '../domain/teamSession.js';
import { migrateGameSessionsDocumentToV2 } from './gameSessionsMigration.js';

const LEGACY_PAIR_KEYS = new Set(['pairs', 'pairAId', 'pairBId', 'byePairId']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function createEmptyGameSessionsDocument() {
  return {
    schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
    sessions: [],
  };
}

export function collectLegacyPairFields(value, found = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectLegacyPairFields(item, found));
    return found;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (LEGACY_PAIR_KEYS.has(key)) found.add(key);
      collectLegacyPairFields(child, found);
    }
  }

  return found;
}

function assertObjectDocument(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('O documento de encontros precisa ser um objeto.');
  }
}

function throwFirstValidationError(result, fallback) {
  throw new Error(result.errors?.[0]?.message || fallback);
}

export function validateWritableGameSessionsDocument(document) {
  assertObjectDocument(document);

  if (document.schemaVersion !== GAME_SESSIONS_SCHEMA_VERSION) {
    throw new Error(
      `Versão de schema de encontros não suportada: ${String(document.schemaVersion)}.`
    );
  }

  if (!Array.isArray(document.sessions)) {
    throw new Error('O documento de encontros precisa ter uma lista de sessões.');
  }

  const legacy = collectLegacyPairFields(document);
  if (legacy.size > 0) {
    throw new Error(
      `Documento de encontros híbrido ou V1 não pode ser salvo (${[...legacy].join(', ')}).`
    );
  }

  const validation = validateV2Document(document);
  if (!validation.ok) {
    throwFirstValidationError(validation, 'O documento de encontros V2 é inválido.');
  }

  return cloneV2Document(document);
}

export function validateGameSessionsDocument(document) {
  return validateWritableGameSessionsDocument(document);
}

export function interpretGameSessionsJson(text) {
  if (text == null || String(text).trim() === '') {
    return {
      document: createEmptyGameSessionsDocument(),
      migrated: false,
      sourceVersion: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON inválido no documento de encontros.');
  }

  assertObjectDocument(parsed);

  if (!Object.prototype.hasOwnProperty.call(parsed, 'schemaVersion')) {
    throw new Error('A versão do schema é obrigatória.');
  }

  const { schemaVersion } = parsed;

  if (schemaVersion === 1) {
    const migrated = migrateGameSessionsDocumentToV2(parsed);
    if (!migrated.ok) {
      throw new Error(
        migrated.errors?.[0]?.message || 'Não foi possível migrar o documento de encontros.'
      );
    }
    const validation = validateV2Document(migrated.document);
    if (!validation.ok) {
      throwFirstValidationError(validation, 'O documento migrado de encontros é inválido.');
    }
    return {
      document: cloneV2Document(migrated.document),
      migrated: true,
      sourceVersion: 1,
    };
  }

  if (schemaVersion === TEAM_SESSION_SCHEMA_VERSION) {
    const legacy = collectLegacyPairFields(parsed);
    if (legacy.size > 0) {
      throw new Error(
        `Documento de encontros híbrido ou V1 não pode ser salvo (${[...legacy].join(', ')}).`
      );
    }
    const validation = validateV2Document(parsed);
    if (!validation.ok) {
      throwFirstValidationError(validation, 'O documento de encontros V2 é inválido.');
    }
    return {
      document: cloneV2Document(parsed),
      migrated: false,
      sourceVersion: 2,
    };
  }

  throw new Error(`Versão de schema de encontros não suportada: ${String(schemaVersion)}.`);
}

export function parseGameSessionsJson(text) {
  return interpretGameSessionsJson(text).document;
}

export function serializeGameSessionsDocument(document) {
  const valid = validateWritableGameSessionsDocument(document);
  return JSON.stringify(
    {
      schemaVersion: valid.schemaVersion,
      sessions: valid.sessions,
    },
    null,
    2
  );
}
