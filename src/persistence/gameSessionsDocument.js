import { GAME_SESSIONS_SCHEMA_VERSION } from './constants.js';

export function createEmptyGameSessionsDocument() {
  return {
    schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
    sessions: [],
  };
}

export function validateGameSessionsDocument(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('O documento de encontros precisa ser um objeto.');
  }

  if (document.schemaVersion !== GAME_SESSIONS_SCHEMA_VERSION) {
    throw new Error(
      `Versão de schema de encontros não suportada: ${String(document.schemaVersion)}.`
    );
  }

  if (!Array.isArray(document.sessions)) {
    throw new Error('O documento de encontros precisa ter uma lista de sessões.');
  }

  return document;
}

export function parseGameSessionsJson(text) {
  if (text == null || String(text).trim() === '') {
    return createEmptyGameSessionsDocument();
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON inválido no documento de encontros.');
  }

  return validateGameSessionsDocument(parsed);
}

export function serializeGameSessionsDocument(document) {
  const valid = validateGameSessionsDocument(document);
  return JSON.stringify(
    {
      schemaVersion: valid.schemaVersion,
      sessions: valid.sessions,
    },
    null,
    2
  );
}
