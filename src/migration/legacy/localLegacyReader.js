import {
  COMPETITIONS_STORAGE_KEY,
  GAME_SESSIONS_STORAGE_KEY,
  GIST_PENDING_CHANGES_STORAGE_KEY,
} from '../../persistence/constants.js';
import {
  createEmptyGameSessionsDocument,
  interpretGameSessionsJson,
} from '../../persistence/gameSessionsDocument.js';
import {
  createEmptyCompetitionDocument,
  interpretCompetitionsJson,
} from '../../persistence/competitionsDocument.js';

export const PLAYERS_STORAGE_KEY = 'volleyPlayers';
export const DRAFTS_STORAGE_KEY = 'volleyDrafts';

export { COMPETITIONS_STORAGE_KEY, GAME_SESSIONS_STORAGE_KEY, GIST_PENDING_CHANGES_STORAGE_KEY };

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage == null) {
    return null;
  }
  return globalThis.localStorage;
}

function readRaw(store, key) {
  if (!store?.getItem) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function parseLegacyPlayersJson(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON inválido em players.json.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('players.json precisa conter um array.');
  }
  return parsed;
}

export function hasLocalLegacyData(storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  return [PLAYERS_STORAGE_KEY, GAME_SESSIONS_STORAGE_KEY, COMPETITIONS_STORAGE_KEY].some((key) => {
    const raw = readRaw(store, key);
    return raw != null && String(raw).trim() !== '';
  });
}

export function readLocalLegacySnapshot(storage) {
  const store = resolveStorage(storage);
  const emptySessions = createEmptyGameSessionsDocument();
  const emptyCompetitions = createEmptyCompetitionDocument();
  const result = {
    players: [],
    sessions: emptySessions,
    competitions: emptyCompetitions,
    found: false,
    sourceType: 'localStorage',
    errors: [],
    playersRaw: false,
    sessionsMigrated: false,
    competitionsMigrated: false,
  };

  if (!store) return result;

  const playersRaw = readRaw(store, PLAYERS_STORAGE_KEY);
  const sessionsRaw = readRaw(store, GAME_SESSIONS_STORAGE_KEY);
  const competitionsRaw = readRaw(store, COMPETITIONS_STORAGE_KEY);
  result.found = [playersRaw, sessionsRaw, competitionsRaw].some(
    (raw) => raw != null && String(raw).trim() !== ''
  );

  if (playersRaw != null && String(playersRaw).trim() !== '') {
    try {
      result.players = parseLegacyPlayersJson(playersRaw);
      result.playersRaw = true;
    } catch (error) {
      result.errors.push(error?.message || 'Não foi possível ler o elenco local.');
    }
  }

  if (sessionsRaw != null && String(sessionsRaw).trim() !== '') {
    try {
      const interpreted = interpretGameSessionsJson(sessionsRaw);
      result.sessions = interpreted.document;
      result.sessionsMigrated = Boolean(interpreted.migrated);
    } catch (error) {
      result.errors.push(error?.message || 'Não foi possível ler os encontros locais.');
    }
  }

  if (competitionsRaw != null && String(competitionsRaw).trim() !== '') {
    try {
      const interpreted = interpretCompetitionsJson(competitionsRaw);
      result.competitions = interpreted.document;
      result.competitionsMigrated = Boolean(interpreted.migrated);
    } catch (error) {
      result.errors.push(error?.message || 'Não foi possível ler as competições locais.');
    }
  }

  return result;
}
