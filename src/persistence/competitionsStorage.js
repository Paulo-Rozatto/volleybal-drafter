import { COMPETITIONS_STORAGE_KEY } from './constants.js';
import {
  createEmptyCompetitionDocument,
  interpretCompetitionsJson,
  parseCompetitionsJson,
  serializeCompetitionsDocument,
} from './competitionsDocument.js';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage == null) {
    throw new Error('localStorage não está disponível.');
  }
  return globalThis.localStorage;
}

export function loadCompetitionsRecord(storage) {
  const store = resolveStorage(storage);
  const raw = store.getItem(COMPETITIONS_STORAGE_KEY);
  if (raw == null) {
    return {
      document: createEmptyCompetitionDocument(),
      sourceVersion: null,
      migrated: false,
    };
  }
  return interpretCompetitionsJson(raw);
}

export function loadCompetitionsDocument(storage) {
  return loadCompetitionsRecord(storage).document;
}

export function saveCompetitionsDocument(document, storage) {
  const store = resolveStorage(storage);
  const serialized = serializeCompetitionsDocument(document);
  store.setItem(COMPETITIONS_STORAGE_KEY, serialized);
  return parseCompetitionsJson(serialized);
}

export function clearCompetitionsDocument(storage) {
  const store = resolveStorage(storage);
  store.removeItem(COMPETITIONS_STORAGE_KEY);
}
