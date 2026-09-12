import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_SCHEMA_VERSION, GAME_SESSIONS_STORAGE_KEY } from './constants.js';
import {
  createEmptyGameSessionsDocument,
  interpretGameSessionsJson,
  parseGameSessionsJson,
  serializeGameSessionsDocument,
  validateGameSessionsDocument,
} from './gameSessionsDocument.js';
import {
  clearGameSessionsDocument,
  loadGameSessionsDocument,
  loadGameSessionsRecord,
  saveGameSessionsDocument,
} from './gameSessionsStorage.js';
import { persistLocalGameSessions, readLocalGameSessions, readPendingGistChanges } from './syncHelpers.js';

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

const emptyV2 = {
  schemaVersion: 2,
  sessions: [],
};

const v1Empty = {
  schemaVersion: 1,
  sessions: [],
};

const v1BrokenRef = {
  schemaVersion: 1,
  sessions: [
    {
      id: 'session-1',
      date: '2026-09-12',
      name: 'Arena',
      status: 'in_progress',
      createdAt: '2026-09-12T18:00:00.000Z',
      updatedAt: '2026-09-12T19:00:00.000Z',
      pairs: [
        {
          id: 'pair-1',
          members: [
            { playerId: 'p1', playerName: 'Erik' },
            { playerId: 'p2', playerName: 'André' },
          ],
        },
      ],
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byePairId: null,
          matches: [{ id: 'match-1', pairAId: 'pair-1', pairBId: 'missing', scoreA: null, scoreB: null }],
        },
      ],
    },
  ],
};

describe('gameSessionsDocument', () => {
  it('cria um documento vazio V2 a cada chamada', () => {
    const first = createEmptyGameSessionsDocument();
    const second = createEmptyGameSessionsDocument();

    expect(GAME_SESSIONS_SCHEMA_VERSION).toBe(2);
    expect(first).toEqual(emptyV2);
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

  it('rejeita schema V1 e desconhecido na escrita', () => {
    expect(() => validateGameSessionsDocument(v1Empty)).toThrow(
      'Versão de schema de encontros não suportada: 1.'
    );
    expect(() =>
      validateGameSessionsDocument({ schemaVersion: 99, sessions: [] })
    ).toThrow('Versão de schema de encontros não suportada: 99.');
  });

  it('rejeita documento híbrido na escrita', () => {
    expect(() =>
      validateGameSessionsDocument({
        schemaVersion: 2,
        sessions: [
          {
            format: { teamSize: 2, teamCount: 2 },
            teams: [],
            rounds: [],
            pairs: [],
          },
        ],
      })
    ).toThrow('Documento de encontros híbrido ou V1 não pode ser salvo');
  });

  it('interpreta V1 migrando e V2 sem migrar', () => {
    const fromV1 = interpretGameSessionsJson(JSON.stringify(v1Empty));
    expect(fromV1).toEqual({
      document: emptyV2,
      migrated: true,
      sourceVersion: 1,
    });

    const fromV2 = interpretGameSessionsJson(JSON.stringify(emptyV2));
    expect(fromV2.migrated).toBe(false);
    expect(fromV2.sourceVersion).toBe(2);
    expect(fromV2.document).toEqual(emptyV2);
    expect(fromV2.document).not.toBe(emptyV2);

    expect(parseGameSessionsJson('{"schemaVersion":1,"sessions":[]}')).toEqual(emptyV2);
  });

  it('trata conteúdo vazio como documento V2 vazio', () => {
    expect(interpretGameSessionsJson('')).toEqual({
      document: emptyV2,
      migrated: false,
      sourceVersion: null,
    });
    expect(interpretGameSessionsJson('   ')).toMatchObject({
      migrated: false,
      sourceVersion: null,
    });
  });

  it('rejeita JSON inválido, schema desconhecido e migração inválida', () => {
    expect(() => parseGameSessionsJson('{not-json')).toThrow(
      'JSON inválido no documento de encontros.'
    );
    expect(() => parseGameSessionsJson(JSON.stringify({ schemaVersion: 9, sessions: [] }))).toThrow(
      'Versão de schema de encontros não suportada: 9.'
    );
    expect(() => parseGameSessionsJson(JSON.stringify(v1BrokenRef))).toThrow(
      'Não é possível migrar uma referência a uma dupla inexistente.'
    );
  });

  it('serializa somente V2 canônico e rejeita V1', () => {
    const json = serializeGameSessionsDocument({
      schemaVersion: 2,
      sessions: [],
      extra: true,
    });
    expect(JSON.parse(json)).toEqual(emptyV2);

    expect(() => serializeGameSessionsDocument(v1Empty)).toThrow(
      'Versão de schema de encontros não suportada: 1.'
    );
    expect(() =>
      serializeGameSessionsDocument({
        schemaVersion: 2,
        sessions: [{ id: 's1', pairs: [], format: { teamSize: 2, teamCount: 2 }, teams: [], rounds: [] }],
      })
    ).toThrow('Documento de encontros híbrido ou V1 não pode ser salvo');
  });

  it('rejeita documento V2 com status inválido na serialização', () => {
    expect(() =>
      serializeGameSessionsDocument({
        schemaVersion: 2,
        sessions: [
          {
            id: 's1',
            date: '2026-09-12',
            name: null,
            status: 'archived',
            createdAt: '2026-09-12T18:00:00.000Z',
            updatedAt: '2026-09-12T18:00:00.000Z',
            format: { teamSize: 2, teamCount: 2 },
            teams: [],
            rounds: [],
          },
        ],
      })
    ).toThrow('O status do encontro precisa ser rascunho, em andamento ou finalizado.');
  });
});

describe('gameSessionsStorage', () => {
  it('retorna documento vazio quando a chave ainda não existe', () => {
    const storage = createMemoryStorage({
      volleyPlayers: '[]',
      volleyDrafts: '[]',
    });
    const loaded = loadGameSessionsRecord(storage);

    expect(loaded).toEqual({
      document: createEmptyGameSessionsDocument(),
      migrated: false,
      sourceVersion: null,
    });
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

  it('salva e carrega um documento V2', () => {
    const storage = createMemoryStorage();
    const document = { schemaVersion: 2, sessions: [] };

    const saved = saveGameSessionsDocument(document, storage);
    document.sessions.push({ id: 'session-2' });

    expect(saved.sessions).toHaveLength(0);
    expect(loadGameSessionsDocument(storage)).toEqual(emptyV2);
  });

  it('rejeita salvar V1 sem gravar', () => {
    const storage = createMemoryStorage({ volleyPlayers: '[]' });
    expect(() => saveGameSessionsDocument(v1Empty, storage)).toThrow(
      'Versão de schema de encontros não suportada: 1.'
    );
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('volleyPlayers')).toBe('[]');
  });

  it('rejeita documento V2 inválido antes de setItem', () => {
    const writes = [];
    const storage = {
      getItem() {
        return null;
      },
      setItem(key, value) {
        writes.push([key, value]);
      },
      removeItem() {},
    };

    expect(() =>
      saveGameSessionsDocument(
        {
          schemaVersion: 2,
          sessions: [
            {
              id: 's1',
              date: '2026-09-12',
              name: null,
              status: 'archived',
              createdAt: '2026-09-12T18:00:00.000Z',
              updatedAt: '2026-09-12T18:00:00.000Z',
              format: { teamSize: 2, teamCount: 2 },
              teams: [],
              rounds: [],
            },
          ],
        },
        storage
      )
    ).toThrow('O status do encontro precisa ser rascunho, em andamento ou finalizado.');
    expect(writes).toEqual([]);
  });

  it('lança erro claro para JSON corrompido e preserva a chave', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: '{broken',
      volleyPlayers: '[{"id":"p1"}]',
    });

    expect(() => loadGameSessionsDocument(storage)).toThrow(
      'JSON inválido no documento de encontros.'
    );
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe('{broken');
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
      [GAME_SESSIONS_STORAGE_KEY]: serializeGameSessionsDocument(emptyV2),
    });

    clearGameSessionsDocument(storage);

    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
    expect(storage.getItem('volleyDrafts')).toBe('[{"id":"d1"}]');
  });
});

describe('migração do cache local', () => {
  it('migra cache V1, grava V2 na mesma chave e marca pendência', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: JSON.stringify(v1Empty),
      volleyPlayers: '[]',
    });

    const result = readLocalGameSessions(storage);

    expect(result.error).toBeNull();
    expect(result.writeError).toBeNull();
    expect(result.migrated).toBe(true);
    expect(result.sourceVersion).toBe(1);
    expect(result.document).toEqual(emptyV2);
    expect(JSON.parse(storage.getItem(GAME_SESSIONS_STORAGE_KEY))).toEqual(emptyV2);
    expect(readPendingGistChanges(storage)).toBe(true);
    expect(storage.getItem('volleyPlayers')).toBe('[]');
  });

  it('carrega cache V2 sem migrar e sem marcar pendência', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: JSON.stringify(emptyV2),
    });

    const result = readLocalGameSessions(storage);
    expect(result.migrated).toBe(false);
    expect(result.sourceVersion).toBe(2);
    expect(result.document).toEqual(emptyV2);
    expect(readPendingGistChanges(storage)).toBe(false);
  });

  it('cache ausente devolve V2 vazio sem gravar', () => {
    const storage = createMemoryStorage();
    const result = readLocalGameSessions(storage);
    expect(result).toMatchObject({
      document: emptyV2,
      error: null,
      migrated: false,
      sourceVersion: null,
      writeError: null,
    });
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBeNull();
  });

  it('JSON inválido permanece intacto e não finge migração', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: '{broken',
      volleyPlayers: '[{"id":"p1"}]',
    });

    const result = readLocalGameSessions(storage);

    expect(result.error).toBe('JSON inválido no documento de encontros.');
    expect(result.migrated).toBe(false);
    expect(result.document).toEqual(emptyV2);
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe('{broken');
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
    expect(readPendingGistChanges(storage)).toBe(false);
  });

  it('falha de migração não chama setItem', () => {
    const writes = [];
    const storage = {
      getItem() {
        return JSON.stringify(v1BrokenRef);
      },
      setItem(key, value) {
        writes.push([key, value]);
      },
      removeItem() {},
    };

    const result = readLocalGameSessions(storage);
    expect(result.migrated).toBe(false);
    expect(result.error).toContain('Não é possível migrar uma referência a uma dupla inexistente.');
    expect(writes).toEqual([]);
  });

  it('falha de gravação mantém V2 em memória e o cache antigo', () => {
    const original = JSON.stringify(v1Empty);
    const storage = {
      getItem(key) {
        if (key === GAME_SESSIONS_STORAGE_KEY) return original;
        return null;
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {},
    };

    const result = readLocalGameSessions(storage);
    expect(result.migrated).toBe(true);
    expect(result.document).toEqual(emptyV2);
    expect(result.writeError).toBe('quota exceeded');
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe(original);
  });

  it('persistência local rejeita V1', () => {
    const storage = createMemoryStorage();
    const result = persistLocalGameSessions(v1Empty, storage);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Versão de schema de encontros não suportada: 1.');
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBeNull();
  });
});
