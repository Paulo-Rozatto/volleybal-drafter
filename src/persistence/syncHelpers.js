import { GAME_SESSIONS_SCHEMA_VERSION, GIST_PENDING_CHANGES_STORAGE_KEY } from './constants.js';
import { createEmptyGameSessionsDocument } from './gameSessionsDocument.js';
import { loadGameSessionsDocument, saveGameSessionsDocument } from './gameSessionsStorage.js';

export const GIST_LOAD_STRATEGY = {
  FRESH: 'fresh',
  KEEP_LOCAL: 'keep_local',
  USE_REMOTE: 'use_remote',
  CANCEL: 'cancel',
};

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage == null) {
    throw new Error('localStorage não está disponível.');
  }
  return globalThis.localStorage;
}

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

export function readPendingGistChanges(storage) {
  try {
    const raw = resolveStorage(storage).getItem(GIST_PENDING_CHANGES_STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export function writePendingGistChanges(value, storage) {
  try {
    resolveStorage(storage).setItem(GIST_PENDING_CHANGES_STORAGE_KEY, value ? 'true' : 'false');
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error.message || 'Não foi possível atualizar o indicador de alterações pendentes.',
    };
  }
}

export function markPendingGistChanges(storage) {
  return writePendingGistChanges(true, storage);
}

export function clearPendingGistChanges(storage) {
  return writePendingGistChanges(false, storage);
}

export function gistLoadNeedsFetch(strategy) {
  return strategy !== GIST_LOAD_STRATEGY.CANCEL;
}

export function applySuccessfulGistLoad({
  strategy,
  localPlayers,
  localGameSessions,
  remotePlayers,
  remoteGameSessions,
}) {
  if (strategy === GIST_LOAD_STRATEGY.KEEP_LOCAL) {
    return {
      players: localPlayers,
      gameSessions: localGameSessions,
      replaceLocal: false,
      gistLoaded: true,
      hasPendingGistChanges: true,
      syncStatus: 'Gist carregado. As alterações locais foram mantidas e ainda precisam ser salvas.',
    };
  }

  return {
    players: remotePlayers,
    gameSessions: remoteGameSessions,
    replaceLocal: true,
    gistLoaded: true,
    hasPendingGistChanges: false,
    syncStatus:
      strategy === GIST_LOAD_STRATEGY.USE_REMOTE
        ? 'Dados locais substituídos pelos dados do Gist.'
        : 'Carregado do Gist com sucesso!',
  };
}

export function applyGistLoadFailure({ error, hasPendingGistChanges, localPlayers, localGameSessions }) {
  return {
    players: localPlayers,
    gameSessions: localGameSessions,
    replaceLocal: false,
    hasPendingGistChanges,
    syncStatus: `Erro ao carregar: ${error?.message || error}`,
  };
}
