import { GAME_SESSIONS_STORAGE_KEY } from './constants.js';
import {
  createEmptyGameSessionsDocument,
  interpretGameSessionsJson,
  parseGameSessionsJson,
  serializeGameSessionsDocument,
} from './gameSessionsDocument.js';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage == null) {
    throw new Error('localStorage não está disponível.');
  }
  return globalThis.localStorage;
}

export function loadGameSessionsRecord(storage) {
  const store = resolveStorage(storage);
  const raw = store.getItem(GAME_SESSIONS_STORAGE_KEY);
  if (raw == null) {
    return {
      document: createEmptyGameSessionsDocument(),
      migrated: false,
      sourceVersion: null,
    };
  }
  return interpretGameSessionsJson(raw);
}

export function loadGameSessionsDocument(storage) {
  return loadGameSessionsRecord(storage).document;
}

export function saveGameSessionsDocument(document, storage) {
  const store = resolveStorage(storage);
  const serialized = serializeGameSessionsDocument(document);
  store.setItem(GAME_SESSIONS_STORAGE_KEY, serialized);
  return parseGameSessionsJson(serialized);
}

export function clearGameSessionsDocument(storage) {
  const store = resolveStorage(storage);
  store.removeItem(GAME_SESSIONS_STORAGE_KEY);
}
