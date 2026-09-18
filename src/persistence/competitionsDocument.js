import { COMPETITION_SCHEMA_VERSION } from './constants.js';
import {
  cloneCompetitionDocument,
  createEmptyCompetitionDocument,
  validateCompetitionDocument,
} from '../domain/competition.js';
import { migrateCompetitionsDocumentToV2 } from './competitionsMigration.js';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export { createEmptyCompetitionDocument };

function assertObjectDocument(document) {
  if (!isPlainObject(document)) {
    throw new Error('O documento de competições precisa ser um objeto.');
  }
}

function throwFirstValidationError(result, fallback) {
  throw new Error(result.errors?.[0]?.message || fallback);
}

export function validateWritableCompetitionsDocument(document) {
  assertObjectDocument(document);

  if (document.schemaVersion !== COMPETITION_SCHEMA_VERSION) {
    throw new Error(
      `Versão de schema de competições não suportada: ${String(document.schemaVersion)}.`
    );
  }

  if (!Array.isArray(document.competitions)) {
    throw new Error('O documento de competições precisa ter uma lista de competições.');
  }

  const validation = validateCompetitionDocument(document);
  if (!validation.ok) {
    throwFirstValidationError(validation, 'O documento de competições é inválido.');
  }

  return cloneCompetitionDocument(document);
}

export function validateCompetitionsDocument(document) {
  return validateWritableCompetitionsDocument(document);
}

export function interpretCompetitionsJson(text) {
  if (text == null || String(text).trim() === '') {
    return {
      document: createEmptyCompetitionDocument(),
      sourceVersion: null,
      migrated: false,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON inválido no documento de competições.');
  }

  assertObjectDocument(parsed);

  if (!Object.prototype.hasOwnProperty.call(parsed, 'schemaVersion')) {
    throw new Error('A versão do schema é obrigatória.');
  }

  const migrated = migrateCompetitionsDocumentToV2(parsed);
  if (!migrated.ok) {
    throw new Error(migrated.errors?.[0]?.message || 'Não foi possível migrar o documento de competições.');
  }

  const validation = validateCompetitionDocument(migrated.document);
  if (!validation.ok) {
    throwFirstValidationError(validation, 'O documento de competições é inválido.');
  }

  return {
    document: cloneCompetitionDocument(migrated.document),
    sourceVersion: parsed.schemaVersion,
    migrated: Boolean(migrated.migrated),
  };
}

export function parseCompetitionsJson(text) {
  return interpretCompetitionsJson(text).document;
}

export function serializeCompetitionsDocument(document) {
  const valid = validateWritableCompetitionsDocument(document);
  return JSON.stringify(
    {
      schemaVersion: valid.schemaVersion,
      competitions: valid.competitions,
    },
    null,
    2
  );
}
