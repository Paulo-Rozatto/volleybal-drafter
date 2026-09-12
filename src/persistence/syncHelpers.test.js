import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_STORAGE_KEY, GIST_PENDING_CHANGES_STORAGE_KEY } from './constants.js';
import { createEmptyGameSessionsDocument } from './gameSessionsDocument.js';
import {
  applyGistLoadFailure,
  applySuccessfulGistLoad,
  canSaveToGist,
  clearPendingGistChanges,
  createSyncLock,
  getGistGateMessage,
  gistLoadNeedsFetch,
  GIST_LOAD_STRATEGY,
  GIST_SESSIONS_MIGRATED_MESSAGE,
  markPendingGistChanges,
  nextGameSessionsDocument,
  persistLocalGameSessions,
  readLocalGameSessions,
  readPendingGistChanges,
  runExclusiveSync,
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

const emptyV2 = createEmptyGameSessionsDocument();

describe('readLocalGameSessions', () => {
  it('usa documento vazio quando a chave não existe', () => {
    const result = readLocalGameSessions(createMemoryStorage());
    expect(result.error).toBeNull();
    expect(result.document).toEqual(emptyV2);
    expect(result.migrated).toBe(false);
  });

  it('não quebra e não apaga cache corrompido', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: '{broken',
      volleyPlayers: '[{"id":"p1"}]',
    });

    const result = readLocalGameSessions(storage);

    expect(result.error).toBe('JSON inválido no documento de encontros.');
    expect(result.document).toEqual(emptyV2);
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe('{broken');
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
  });
});

describe('nextGameSessionsDocument', () => {
  it('aplica uma atualização válida e força o schema 2', () => {
    const current = { schemaVersion: 2, sessions: [{ id: 'a' }] };
    const next = { schemaVersion: 2, sessions: [{ id: 'b' }] };
    const result = nextGameSessionsDocument(current, next);

    expect(result).toEqual({
      schemaVersion: 2,
      sessions: [{ id: 'b' }],
    });
    expect(result).not.toBe(current);
    expect(result).not.toBe(next);
    expect(result.sessions).not.toBe(next.sessions);
  });

  it('aceita uma função atualizadora válida', () => {
    const current = { schemaVersion: 2, sessions: [{ id: 'a' }] };
    const result = nextGameSessionsDocument(current, (prev) => ({
      schemaVersion: 2,
      sessions: [...prev.sessions, { id: 'c' }],
    }));

    expect(result).toEqual({
      schemaVersion: 2,
      sessions: [{ id: 'a' }, { id: 'c' }],
    });
    expect(result).not.toBe(current);
  });

  it('rejeita schemaVersion 1', () => {
    expect(() =>
      nextGameSessionsDocument(
        { schemaVersion: 2, sessions: [] },
        { schemaVersion: 1, sessions: [] }
      )
    ).toThrow('Versão de schema de encontros não suportada: 1.');
  });

  it('rejeita documento híbrido', () => {
    expect(() =>
      nextGameSessionsDocument(
        { schemaVersion: 2, sessions: [] },
        { schemaVersion: 2, sessions: [{ id: 's1', pairs: [] }] }
      )
    ).toThrow('Documento de encontros híbrido ou V1 não pode ser salvo');
  });

  it('rejeita sessions ausente', () => {
    expect(() =>
      nextGameSessionsDocument({ schemaVersion: 2, sessions: [] }, { schemaVersion: 2 })
    ).toThrow('O documento de encontros precisa ter uma lista de sessões.');
  });

  it('rejeita sessions que não seja array', () => {
    expect(() =>
      nextGameSessionsDocument(
        { schemaVersion: 2, sessions: [] },
        { schemaVersion: 2, sessions: { id: 'a' } }
      )
    ).toThrow('O documento de encontros precisa ter uma lista de sessões.');
  });

  it('rejeita entrada null ou undefined', () => {
    const current = { schemaVersion: 2, sessions: [{ id: 'a' }] };
    expect(() => nextGameSessionsDocument(current, null)).toThrow(
      'A atualização do documento de encontros precisa ser um objeto.'
    );
    expect(() => nextGameSessionsDocument(current, undefined)).toThrow(
      'A atualização do documento de encontros precisa ser um objeto.'
    );
  });
});

describe('persistLocalGameSessions', () => {
  it('salva com sucesso um documento V2', () => {
    const storage = createMemoryStorage({ volleyPlayers: '[]' });
    const result = persistLocalGameSessions(emptyV2, storage);

    expect(result).toEqual({ ok: true, error: null });
    expect(storage.getItem('volleyPlayers')).toBe('[]');
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toContain('"schemaVersion": 2');
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

    const result = persistLocalGameSessions(emptyV2, storage);

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

  it('não bloqueia o salvamento só por existir alteração pendente', () => {
    expect(
      canSaveToGist({ gistLoaded: true, isSyncing: false, hasPassword: true })
    ).toBe(true);
  });
});

describe('indicador persistido de alterações pendentes', () => {
  it('lê o indicador persistido como true', () => {
    const storage = createMemoryStorage({
      [GIST_PENDING_CHANGES_STORAGE_KEY]: 'true',
    });
    expect(readPendingGistChanges(storage)).toBe(true);
  });

  it('ausência da chave resulta em false', () => {
    expect(readPendingGistChanges(createMemoryStorage())).toBe(false);
  });

  it('trata valor inválido com segurança', () => {
    expect(
      readPendingGistChanges(createMemoryStorage({ [GIST_PENDING_CHANGES_STORAGE_KEY]: 'yes' }))
    ).toBe(false);
    expect(
      readPendingGistChanges(createMemoryStorage({ [GIST_PENDING_CHANGES_STORAGE_KEY]: 'false' }))
    ).toBe(false);
    expect(
      readPendingGistChanges(createMemoryStorage({ [GIST_PENDING_CHANGES_STORAGE_KEY]: '{broken' }))
    ).toBe(false);
  });

  it('marca e limpa a pendência', () => {
    const storage = createMemoryStorage({ volleyPlayers: '[]' });

    expect(markPendingGistChanges(storage)).toEqual({ ok: true, error: null });
    expect(storage.getItem(GIST_PENDING_CHANGES_STORAGE_KEY)).toBe('true');
    expect(readPendingGistChanges(storage)).toBe(true);

    expect(clearPendingGistChanges(storage)).toEqual({ ok: true, error: null });
    expect(storage.getItem(GIST_PENDING_CHANGES_STORAGE_KEY)).toBe('false');
    expect(readPendingGistChanges(storage)).toBe(false);
    expect(storage.getItem('volleyPlayers')).toBe('[]');
  });

  it('erro do storage não apaga outras chaves', () => {
    const storage = {
      getItem(key) {
        if (key === 'volleyPlayers') return '[{"id":"p1"}]';
        if (key === GAME_SESSIONS_STORAGE_KEY) return '{"schemaVersion":2,"sessions":[]}';
        return null;
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {},
    };

    const result = markPendingGistChanges(storage);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('quota exceeded');
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBe('{"schemaVersion":2,"sessions":[]}');
  });
});

describe('estratégias de carregamento do Gist', () => {
  const localPlayers = [{ id: 'local' }];
  const remotePlayers = [{ id: 'remote' }];
  const localGameSessions = { schemaVersion: 2, sessions: [{ id: 'local-session' }] };
  const remoteGameSessions = { schemaVersion: 2, sessions: [{ id: 'remote-session' }] };

  it('Manter alterações locais preserva jogadores e encontros e a pendência', () => {
    const result = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.KEEP_LOCAL,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
      remoteMigrated: true,
    });

    expect(result.replaceLocal).toBe(false);
    expect(result.players).toBe(localPlayers);
    expect(result.gameSessions).toBe(localGameSessions);
    expect(result.gistLoaded).toBe(true);
    expect(result.hasPendingGistChanges).toBe(true);
    expect(result.syncStatus).toBe(
      'Gist carregado. As alterações locais foram mantidas e ainda precisam ser salvas.'
    );
  });

  it('Usar dados do Gist V2 limpa a pendência', () => {
    const result = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.USE_REMOTE,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
      remoteMigrated: false,
    });

    expect(result.replaceLocal).toBe(true);
    expect(result.players).toBe(remotePlayers);
    expect(result.gameSessions).toBe(remoteGameSessions);
    expect(result.gistLoaded).toBe(true);
    expect(result.hasPendingGistChanges).toBe(false);
    expect(result.syncStatus).toBe('Dados locais substituídos pelos dados do Gist.');
  });

  it('Usar dados do Gist V1 migrado mantém a pendência', () => {
    const result = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.USE_REMOTE,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
      remoteMigrated: true,
    });

    expect(result.replaceLocal).toBe(true);
    expect(result.hasPendingGistChanges).toBe(true);
    expect(result.syncStatus).toBe(GIST_SESSIONS_MIGRATED_MESSAGE);
  });

  it('GET V1 fresco marca pendência e não dispara PATCH', () => {
    const result = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.FRESH,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
      remoteMigrated: true,
    });

    expect(result.replaceLocal).toBe(true);
    expect(result.gistLoaded).toBe(true);
    expect(result.hasPendingGistChanges).toBe(true);
    expect(result.syncStatus).toBe(GIST_SESSIONS_MIGRATED_MESSAGE);
  });

  it('GET V2 fresco não marca pendência', () => {
    const result = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.FRESH,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
      remoteMigrated: false,
    });

    expect(result.hasPendingGistChanges).toBe(false);
    expect(result.syncStatus).toBe('Carregado do Gist com sucesso!');
  });

  it('cancelar não realiza carregamento', () => {
    expect(gistLoadNeedsFetch(GIST_LOAD_STRATEGY.CANCEL)).toBe(false);
    expect(gistLoadNeedsFetch(GIST_LOAD_STRATEGY.KEEP_LOCAL)).toBe(true);
    expect(gistLoadNeedsFetch(GIST_LOAD_STRATEGY.USE_REMOTE)).toBe(true);
    expect(gistLoadNeedsFetch(GIST_LOAD_STRATEGY.FRESH)).toBe(true);
  });

  it('erro de GET mantém os dados e a pendência local', () => {
    const result = applyGistLoadFailure({
      error: new Error('rede indisponível'),
      hasPendingGistChanges: true,
      localPlayers,
      localGameSessions,
    });

    expect(result.replaceLocal).toBe(false);
    expect(result.players).toBe(localPlayers);
    expect(result.gameSessions).toBe(localGameSessions);
    expect(result.hasPendingGistChanges).toBe(true);
    expect(result.syncStatus).toBe('Erro ao carregar: rede indisponível');
  });
});

describe('proteção de reentrada da sincronização', () => {
  it('segunda chamada simultânea de load não inicia GET', async () => {
    const lock = createSyncLock();
    let loads = 0;
    let releaseFirst;
    const first = runExclusiveSync(
      lock,
      () =>
        new Promise((resolve) => {
          loads += 1;
          releaseFirst = resolve;
        })
    );
    const second = await runExclusiveSync(lock, async () => {
      loads += 1;
      return 'second-load';
    });

    expect(second).toEqual({ started: false, result: undefined });
    expect(loads).toBe(1);
    releaseFirst('ok');
    await expect(first).resolves.toEqual({ started: true, result: 'ok' });
  });

  it('segunda chamada simultânea de save não inicia PATCH', async () => {
    const lock = createSyncLock();
    let patches = 0;
    let releaseFirst;
    const first = runExclusiveSync(
      lock,
      () =>
        new Promise((resolve) => {
          patches += 1;
          releaseFirst = resolve;
        })
    );
    const second = await runExclusiveSync(lock, async () => {
      patches += 1;
      return 'second-save';
    });

    expect(second.started).toBe(false);
    expect(patches).toBe(1);
    releaseFirst('saved');
    await expect(first).resolves.toEqual({ started: true, result: 'saved' });
  });

  it('erro libera o lock para a próxima operação', async () => {
    const lock = createSyncLock();
    await expect(
      runExclusiveSync(lock, async () => {
        throw new Error('falha de rede');
      })
    ).rejects.toThrow('falha de rede');

    const next = await runExclusiveSync(lock, async () => 'recovered');
    expect(next).toEqual({ started: true, result: 'recovered' });
    expect(lock.isLocked()).toBe(false);
  });
});
