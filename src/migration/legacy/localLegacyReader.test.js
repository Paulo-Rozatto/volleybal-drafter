import { describe, expect, it } from 'vitest';
import {
  COMPETITIONS_STORAGE_KEY,
  GAME_SESSIONS_STORAGE_KEY,
} from '../../persistence/constants.js';
import { createEmptyGameSessionsDocument } from '../../persistence/gameSessionsDocument.js';
import { createEmptyCompetitionDocument } from '../../persistence/competitionsDocument.js';
import {
  GIST_PENDING_CHANGES_STORAGE_KEY,
  PLAYERS_STORAGE_KEY,
  hasLocalLegacyData,
  parseLegacyPlayersJson,
  readLocalLegacySnapshot,
} from './localLegacyReader.js';

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

describe('localLegacyReader', () => {
  it('não considera pending Gist e não grava no storage', () => {
    const storage = createMemoryStorage({
      [PLAYERS_STORAGE_KEY]: JSON.stringify([{ id: 'p1', name: 'Ana', score: 3, gender: 'F', height: 'short' }]),
      [GIST_PENDING_CHANGES_STORAGE_KEY]: 'true',
    });
    const before = storage.snapshot();
    expect(hasLocalLegacyData(storage)).toBe(true);
    const snapshot = readLocalLegacySnapshot(storage);
    expect(snapshot.found).toBe(true);
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0].name).toBe('Ana');
    expect(storage.snapshot()).toEqual(before);
  });

  it('interpreta V1 de encontros em memória sem regravar a chave', () => {
    const v1 = {
      schemaVersion: 1,
      sessions: [
        {
          id: 's1',
          date: '2026-09-12',
          name: 'Arena',
          status: 'draft',
          createdAt: '2026-09-12T18:00:00.000Z',
          updatedAt: '2026-09-12T18:00:00.000Z',
          pairs: [],
          rounds: [],
        },
      ],
    };
    const raw = JSON.stringify(v1);
    const storage = createMemoryStorage({ [GAME_SESSIONS_STORAGE_KEY]: raw });
    const snapshot = readLocalLegacySnapshot(storage);
    expect(snapshot.sessionsMigrated).toBe(true);
    expect(snapshot.sessions.schemaVersion).toBe(2);
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe(raw);
  });

  it('ausência de chaves não é encontrada e devolve documentos vazios', () => {
    const storage = createMemoryStorage();
    expect(hasLocalLegacyData(storage)).toBe(false);
    const snapshot = readLocalLegacySnapshot(storage);
    expect(snapshot.found).toBe(false);
    expect(snapshot.sessions).toEqual(createEmptyGameSessionsDocument());
    expect(snapshot.competitions).toEqual(createEmptyCompetitionDocument());
    expect(snapshot.players).toEqual([]);
  });

  it('JSON quebrado não apaga a chave', () => {
    const storage = createMemoryStorage({
      [COMPETITIONS_STORAGE_KEY]: '{broken',
    });
    const snapshot = readLocalLegacySnapshot(storage);
    expect(snapshot.found).toBe(true);
    expect(snapshot.errors.length).toBeGreaterThan(0);
    expect(storage.getItem(COMPETITIONS_STORAGE_KEY)).toBe('{broken');
  });

  it('parseLegacyPlayersJson rejeita não-array', () => {
    expect(parseLegacyPlayersJson('')).toEqual([]);
    expect(() => parseLegacyPlayersJson('{}')).toThrow(/array/);
  });
});
