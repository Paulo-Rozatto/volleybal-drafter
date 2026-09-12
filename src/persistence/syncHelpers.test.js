import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_STORAGE_KEY } from './constants.js';
import { createEmptyGameSessionsDocument } from './gameSessionsDocument.js';
import {
  canSaveToGist,
  getGistGateMessage,
  nextGameSessionsDocument,
  persistLocalGameSessions,
  readLocalGameSessions,
} from './syncHelpers.js';

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
  };
}

describe('readLocalGameSessions', () => {
  it('usa documento vazio quando a chave não existe', () => {
    const result = readLocalGameSessions(createMemoryStorage());
    expect(result.error).toBeNull();
    expect(result.document).toEqual(createEmptyGameSessionsDocument());
  });

  it('não quebra e não apaga cache corrompido', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: '{broken',
      volleyPlayers: '[{"id":"p1"}]',
    });

    const result = readLocalGameSessions(storage);

    expect(result.error).toBe('JSON inválido no documento de encontros.');
    expect(result.document).toEqual(createEmptyGameSessionsDocument());
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe('{broken');
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
  });
});

describe('nextGameSessionsDocument', () => {
  it('aplica uma atualização válida e força o schema atual', () => {
    const current = { schemaVersion: 1, sessions: [{ id: 'a' }] };
    const next = { schemaVersion: 1, sessions: [{ id: 'b' }] };
    const result = nextGameSessionsDocument(current, next);

    expect(result).toEqual({
      schemaVersion: 1,
      sessions: [{ id: 'b' }],
    });
    expect(result).not.toBe(current);
    expect(result).not.toBe(next);
    expect(result.sessions).not.toBe(next.sessions);
  });

  it('aceita uma função atualizadora válida', () => {
    const current = { schemaVersion: 1, sessions: [{ id: 'a' }] };
    const result = nextGameSessionsDocument(current, (prev) => ({
      schemaVersion: 1,
      sessions: [...prev.sessions, { id: 'c' }],
    }));

    expect(result).toEqual({
      schemaVersion: 1,
      sessions: [{ id: 'a' }, { id: 'c' }],
    });
    expect(result).not.toBe(current);
  });

  it('rejeita schemaVersion 2', () => {
    expect(() =>
      nextGameSessionsDocument(
        { schemaVersion: 1, sessions: [] },
        { schemaVersion: 2, sessions: [] }
      )
    ).toThrow('Versão de schema de encontros não suportada: 2.');
  });

  it('rejeita sessions ausente', () => {
    expect(() =>
      nextGameSessionsDocument({ schemaVersion: 1, sessions: [] }, { schemaVersion: 1 })
    ).toThrow('O documento de encontros precisa ter uma lista de sessões.');
  });

  it('rejeita sessions que não seja array', () => {
    expect(() =>
      nextGameSessionsDocument(
        { schemaVersion: 1, sessions: [] },
        { schemaVersion: 1, sessions: { id: 'a' } }
      )
    ).toThrow('O documento de encontros precisa ter uma lista de sessões.');
  });

  it('rejeita entrada null ou undefined', () => {
    const current = { schemaVersion: 1, sessions: [{ id: 'a' }] };
    expect(() => nextGameSessionsDocument(current, null)).toThrow(
      'A atualização do documento de encontros precisa ser um objeto.'
    );
    expect(() => nextGameSessionsDocument(current, undefined)).toThrow(
      'A atualização do documento de encontros precisa ser um objeto.'
    );
  });
});

describe('persistLocalGameSessions', () => {
  it('salva com sucesso', () => {
    const storage = createMemoryStorage({ volleyPlayers: '[]' });
    const result = persistLocalGameSessions(
      { schemaVersion: 1, sessions: [{ id: 's1' }] },
      storage
    );

    expect(result).toEqual({ ok: true, error: null });
    expect(storage.getItem('volleyPlayers')).toBe('[]');
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toContain('s1');
  });

  it('retorna erro quando setItem lança e não altera outras chaves', () => {
    const storage = {
      getItem(key) {
        if (key === 'volleyPlayers') return '[{"id":"p1"}]';
        return null;
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {},
    };

    const result = persistLocalGameSessions(
      { schemaVersion: 1, sessions: [] },
      storage
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('quota exceeded');
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
  });
});

describe('mensagens e permissão de salvamento', () => {
  it('mostra os três estados da sincronização', () => {
    expect(getGistGateMessage({ gistLoaded: false, hasPendingGistChanges: true })).toBe(
      'Carregue o Gist antes de salvar'
    );
    expect(getGistGateMessage({ gistLoaded: true, hasPendingGistChanges: true })).toBe(
      'Alterações não salvas no Gist'
    );
    expect(getGistGateMessage({ gistLoaded: true, hasPendingGistChanges: false })).toBe(
      'Dados sincronizados com o Gist'
    );
  });

  it('impede salvar antes do primeiro carregamento', () => {
    expect(canSaveToGist({ gistLoaded: false, isSyncing: false, hasPassword: true })).toBe(false);
    expect(canSaveToGist({ gistLoaded: true, isSyncing: false, hasPassword: true })).toBe(true);
    expect(canSaveToGist({ gistLoaded: true, isSyncing: true, hasPassword: true })).toBe(false);
    expect(canSaveToGist({ gistLoaded: true, isSyncing: false, hasPassword: false })).toBe(false);
  });
});
