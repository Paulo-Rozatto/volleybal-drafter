import {
  COMPETITIONS_STORAGE_KEY,
  GAME_SESSIONS_STORAGE_KEY,
} from './persistence/constants.js';

const PLAYERS_STORAGE_KEY = 'volleyPlayers';

export function hasBrowserLegacyHint() {
  try {
    const store = globalThis.localStorage;
    if (!store?.getItem) return false;
    return [PLAYERS_STORAGE_KEY, GAME_SESSIONS_STORAGE_KEY, COMPETITIONS_STORAGE_KEY].some((key) => {
      const raw = store.getItem(key);
      return raw != null && String(raw).trim() !== '';
    });
  } catch {
    return false;
  }
}
