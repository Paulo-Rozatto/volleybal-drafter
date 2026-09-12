import { GAME_SESSIONS_SCHEMA_VERSION, GIST_PENDING_CHANGES_STORAGE_KEY } from './constants.js';
import {
  collectLegacyPairFields,
  createEmptyGameSessionsDocument,
} from './gameSessionsDocument.js';
import { loadGameSessionsRecord, saveGameSessionsDocument } from './gameSessionsStorage.js';
import { GIST_REVISION_CONFLICT } from '../gistRevision.js';

export const GIST_LOAD_STRATEGY = {
  FRESH: 'fresh',
  KEEP_LOCAL: 'keep_local',
  USE_REMOTE: 'use_remote',
  CANCEL: 'cancel',
};

export const GIST_SESSIONS_MIGRATED_MESSAGE =
  'Os encontros foram migrados para o novo formato. Salve no Gist para concluir a atualização.';

export const GIST_KEEP_LOCAL_MESSAGE =
  'Gist carregado. As alterações locais foram mantidas. Salvar substituirá os arquivos remotos.';

export const GIST_SAVE_REVISION_UNCONFIRMED_MESSAGE =
  'Salvo no Gist, mas a revisão remota não foi confirmada. Recarregue os dados antes de salvar novamente.';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage == null) {
    throw new Error('localStorage não está disponível.');
  }
  return globalThis.localStorage;
}

export function readLocalGameSessions(storage) {
  let store;
  try {
    store = resolveStorage(storage);
  } catch (error) {
    return {
      document: createEmptyGameSessionsDocument(),
      error: error.message || 'Cache local de encontros inválido.',
      migrated: false,
      sourceVersion: null,
      writeError: null,
    };
  }

  try {
    const loaded = loadGameSessionsRecord(store);
    let writeError = null;

    if (loaded.migrated) {
      try {
        saveGameSessionsDocument(loaded.document, store);
      } catch (error) {
        writeError = error.message || 'Não foi possível salvar o cache local de encontros.';
      }
      markPendingGistChanges(store);
    }

    return {
      document: loaded.document,
      error: null,
      migrated: loaded.migrated,
      sourceVersion: loaded.sourceVersion,
      writeError,
    };
  } catch (error) {
    return {
      document: createEmptyGameSessionsDocument(),
      error: error.message || 'Cache local de encontros inválido.',
      migrated: false,
      sourceVersion: null,
      writeError: null,
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

  const legacy = collectLegacyPairFields(incoming);
  if (legacy.size > 0) {
    throw new Error(
      `Documento de encontros híbrido ou V1 não pode ser salvo (${[...legacy].join(', ')}).`
    );
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

export function canSaveToGist({ gistLoaded, isSyncing, hasPassword, hasRevision = true }) {
  return Boolean(gistLoaded && !isSyncing && hasPassword && hasRevision);
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

export function createSyncLock() {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}

export async function runExclusiveSync(lock, task) {
  if (!lock.tryAcquire()) {
    return { started: false, result: undefined };
  }

  try {
    return { started: true, result: await task() };
  } finally {
    lock.release();
  }
}

export function applySuccessfulGistLoad({
  strategy,
  localPlayers,
  localGameSessions,
  remotePlayers,
  remoteGameSessions,
  remoteMigrated = false,
}) {
  if (strategy === GIST_LOAD_STRATEGY.KEEP_LOCAL) {
    return {
      players: localPlayers,
      gameSessions: localGameSessions,
      replaceLocal: false,
      gistLoaded: true,
      hasPendingGistChanges: true,
      syncStatus: GIST_KEEP_LOCAL_MESSAGE,
    };
  }

  const pendingBecauseMigrated = Boolean(remoteMigrated);
  const migratedMessage = GIST_SESSIONS_MIGRATED_MESSAGE;
  const replacedMessage =
    strategy === GIST_LOAD_STRATEGY.USE_REMOTE
      ? 'Dados locais substituídos pelos dados do Gist.'
      : 'Carregado do Gist com sucesso!';

  return {
    players: remotePlayers,
    gameSessions: remoteGameSessions,
    replaceLocal: true,
    gistLoaded: true,
    hasPendingGistChanges: pendingBecauseMigrated,
    syncStatus: pendingBecauseMigrated ? migratedMessage : replacedMessage,
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

export function applyGistSaveSuccess({ revision }) {
  if (!revision) {
    return {
      gistLoaded: false,
      revision: null,
      clearRevision: true,
      hasPendingGistChanges: true,
      syncStatus: GIST_SAVE_REVISION_UNCONFIRMED_MESSAGE,
    };
  }

  return {
    gistLoaded: true,
    revision,
    clearRevision: false,
    hasPendingGistChanges: false,
    syncStatus: 'Salvo no Gist com sucesso!',
  };
}

export function applyGistSaveFailure({
  error,
  gistLoaded,
  revision,
  hasPendingGistChanges,
}) {
  if (error?.code === GIST_REVISION_CONFLICT) {
    return {
      gistLoaded: false,
      revision,
      clearRevision: false,
      hasPendingGistChanges,
      syncStatus: error.message,
    };
  }

  return {
    gistLoaded,
    revision,
    clearRevision: false,
    hasPendingGistChanges,
    syncStatus: `Erro ao salvar: ${error?.message || error}`,
  };
}
