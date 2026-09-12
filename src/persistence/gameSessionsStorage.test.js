import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_SCHEMA_VERSION, GAME_SESSIONS_STORAGE_KEY } from './constants.js';
import {
  createEmptyGameSessionsDocument,
  parseGameSessionsJson,
  serializeGameSessionsDocument,
  validateGameSessionsDocument,
} from './gameSessionsDocument.js';
import {
  clearGameSessionsDocument,
  loadGameSessionsDocument,
  saveGameSessionsDocument,
} from './gameSessionsStorage.js';

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

describe('gameSessionsDocument', () => {
  it('cria um documento vazio novo a cada chamada', () => {
    const first = createEmptyGameSessionsDocument();
    const second = createEmptyGameSessionsDocument();

    expect(first).toEqual({
      schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
      sessions: [],
    });
    expect(first).not.toBe(second);
    expect(first.sessions).not.toBe(second.sessions);

    first.sessions.push({ id: 'session-1' });
    expect(second.sessions).toEqual([]);
  });

  it('rejeita documento que não é objeto', () => {
    expect(() => validateGameSessionsDocument(null)).toThrow(
      'O documento de encontros precisa ser um objeto.'
    );
    expect(() => validateGameSessionsDocument([])).toThrow(
      'O documento de encontros precisa ser um objeto.'
    );
  });

  it('rejeita schema desconhecido sem converter', () => {
    expect(() =>
      validateGameSessionsDocument({ schemaVersion: 2, sessions: [] })
    ).toThrow('Versão de schema de encontros não suportada: 2.');
  });

  it('interpreta JSON válido e rejeita JSON inválido', () => {
    const parsed = parseGameSessionsJson(
      '{"schemaVersion":1,"sessions":[{"id":"s1"}]}'
    );
    expect(parsed.sessions).toHaveLength(1);

    expect(() => parseGameSessionsJson('{not-json')).toThrow(
      'JSON inválido no documento de encontros.'
    );
  });

  it('serializa somente a estrutura superior do documento', () => {
    const json = serializeGameSessionsDocument({
      schemaVersion: 1,
      sessions: [{ id: 's1' }],
      extra: true,
    });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      schemaVersion: 1,
      sessions: [{ id: 's1' }],
    });
  });
});

describe('gameSessionsStorage', () => {
  it('retorna documento vazio quando a chave ainda não existe', () => {
    const storage = createMemoryStorage({
      volleyPlayers: '[]',
      volleyDrafts: '[]',
    });
    const loaded = loadGameSessionsDocument(storage);

    expect(loaded).toEqual(createEmptyGameSessionsDocument());
    expect(storage.snapshot().volleyPlayers).toBe('[]');
    expect(storage.snapshot().volleyDrafts).toBe('[]');
    expect(storage.snapshot()[GAME_SESSIONS_STORAGE_KEY]).toBeUndefined();
  });

  it('cada carga sem chave devolve um objeto novo', () => {
    const storage = createMemoryStorage();
    const first = loadGameSessionsDocument(storage);
    const second = loadGameSessionsDocument(storage);
    expect(first).not.toBe(second);
  });

  it('salva e carrega o documento', () => {
    const storage = createMemoryStorage();
    const document = {
      schemaVersion: 1,
      sessions: [{ id: 'session-1', name: 'Sábado' }],
    };

    const saved = saveGameSessionsDocument(document, storage);
    document.sessions.push({ id: 'session-2' });

    expect(saved.sessions).toHaveLength(1);
    expect(loadGameSessionsDocument(storage)).toEqual({
      schemaVersion: 1,
      sessions: [{ id: 'session-1', name: 'Sábado' }],
    });
  });

  it('lança erro claro para JSON corrompido', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: '{broken',
      volleyPlayers: '[{"id":"p1"}]',
    });

    expect(() => loadGameSessionsDocument(storage)).toThrow(
      'JSON inválido no documento de encontros.'
    );
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
  });

  it('lança erro para schema desconhecido', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 99,
        sessions: [],
      }),
    });

    expect(() => loadGameSessionsDocument(storage)).toThrow(
      'Versão de schema de encontros não suportada: 99.'
    );
  });

  it('remove somente a chave dos encontros', () => {
    const storage = createMemoryStorage({
      volleyPlayers: '[{"id":"p1"}]',
      volleyDrafts: '[{"id":"d1"}]',
      [GAME_SESSIONS_STORAGE_KEY]: serializeGameSessionsDocument({
        schemaVersion: 1,
        sessions: [{ id: 's1' }],
      }),
    });

    clearGameSessionsDocument(storage);

    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
    expect(storage.getItem('volleyDrafts')).toBe('[{"id":"d1"}]');
  });
});
