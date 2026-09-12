import { GAME_SESSIONS_SCHEMA_VERSION } from './constants.js';
import { createEmptyGameSessionsDocument } from './gameSessionsDocument.js';
import { loadGameSessionsDocument, saveGameSessionsDocument } from './gameSessionsStorage.js';

export function readLocalGameSessions(storage) {
  try {
    return {
      document: loadGameSessionsDocument(storage),
      error: null,
    };
  } catch (error) {
    return {
      document: createEmptyGameSessionsDocument(),
      error: error.message || 'Cache local de encontros inválido.',
    };
  }
}

export function nextGameSessionsDocument(current, next) {
  const incoming = typeof next === 'function' ? next(current) : next;

  if (incoming == null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('A atualização do documento de encontros precisa ser um objeto.');
  }

  if (
    Object.prototype.hasOwnProperty.call(incoming, 'schemaVersion') &&
    incoming.schemaVersion !== GAME_SESSIONS_SCHEMA_VERSION
  ) {
    throw new Error(
      `Versão de schema de encontros não suportada: ${String(incoming.schemaVersion)}.`
    );
  }

  if (!Array.isArray(incoming.sessions)) {
    throw new Error('O documento de encontros precisa ter uma lista de sessões.');
  }

  return {
    schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
    sessions: [...incoming.sessions],
  };
}

export function persistLocalGameSessions(document, storage) {
  try {
    saveGameSessionsDocument(document, storage);
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error.message || 'Não foi possível salvar o cache local de encontros.',
    };
  }
}

export function getGistGateMessage({ gistLoaded, hasPendingGistChanges }) {
  if (!gistLoaded) return 'Carregue o Gist antes de salvar';
  if (hasPendingGistChanges) return 'Alterações não salvas no Gist';
  return 'Dados sincronizados com o Gist';
}

export function canSaveToGist({ gistLoaded, isSyncing, hasPassword }) {
  return Boolean(gistLoaded && !isSyncing && hasPassword);
}
