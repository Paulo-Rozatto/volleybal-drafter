import { describe, expect, it, vi } from 'vitest';
import {
  GIST_EXPECTED_REVISION_REQUIRED_MESSAGE,
  GIST_ID,
  GIST_REVISION_CONFLICT,
  GIST_REVISION_CONFLICT_MESSAGE,
  loadGistState,
  saveGistState,
} from './gistService.js';
import { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from './persistence/constants.js';
import { createEmptyGameSessionsDocument } from './persistence/gameSessionsDocument.js';
import {
  applyGistSaveFailure,
  applyGistSaveSuccess,
  applySuccessfulGistLoad,
  canSaveToGist,
  createSyncLock,
  GIST_KEEP_LOCAL_MESSAGE,
  GIST_LOAD_STRATEGY,
  GIST_SAVE_REVISION_UNCONFIRMED_MESSAGE,
  gistLoadNeedsFetch,
  runExclusiveSync,
} from './persistence/syncHelpers.js';

const TOKEN = 'ghp_test_token_secret';
const EMPTY = createEmptyGameSessionsDocument();

function jsonResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  };
}

function gistBody({ version, updatedAt, files } = {}) {
  const body = {
    files: files ?? {
      [PLAYERS_FILENAME]: { content: JSON.stringify([{ id: 'p1', name: 'Erik' }]) },
      [GAME_SESSIONS_FILENAME]: { content: JSON.stringify(EMPTY) },
    },
  };
  if (version) body.history = [{ version }];
  if (updatedAt) body.updated_at = updatedAt;
  return body;
}

function mockFetchQueue(responses) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (next == null) throw new Error('fetch inesperado');
    return typeof next === 'function' ? next() : next;
  });
}

describe('carregamento com revisão', () => {
  it('GET devolve revisão por history[0].version', async () => {
    const fetchImpl = mockFetchQueue([jsonResponse(gistBody({ version: 'rev-A' }))]);
    const state = await loadGistState({ fetchImpl });
    expect(state.revision).toBe('version:rev-A');
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
  });

  it('GET usa fallback updated_at', async () => {
    const fetchImpl = mockFetchQueue([
      jsonResponse(gistBody({ updatedAt: '2026-09-12T21:46:00Z' })),
    ]);
    const state = await loadGistState({ fetchImpl });
    expect(state.revision).toBe('updated_at:2026-09-12T21:46:00Z');
  });

  it('GET rejeita revisão ausente', async () => {
    const fetchImpl = mockFetchQueue([jsonResponse({ files: gistBody().files })]);
    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'A resposta do Gist não inclui uma revisão válida.'
    );
  });

  it('GET V1 migrado preserva semântica e inclui revisão', async () => {
    const fetchImpl = mockFetchQueue([
      jsonResponse(
        gistBody({
          version: 'rev-v1',
          files: {
            [GAME_SESSIONS_FILENAME]: {
              content: JSON.stringify({
                schemaVersion: 1,
                sessions: [
                  {
                    id: 's1',
                    date: '2026-09-12',
                    name: null,
                    status: 'draft',
                    createdAt: '2026-09-12T18:00:00.000Z',
                    updatedAt: '2026-09-12T18:00:00.000Z',
                    pairs: [],
                    rounds: [],
                  },
                ],
              }),
            },
          },
        })
      ),
    ]);

    const state = await loadGistState({ fetchImpl });
    expect(state.migrated).toBe(true);
    expect(state.sourceVersion).toBe(1);
    expect(state.gameSessions.schemaVersion).toBe(2);
    expect(state.revision).toBe('version:rev-v1');
    expect(state.gameSessions.sessions[0]).not.toHaveProperty('pairs');
  });
});

describe('preflight de salvamento', () => {
  it('revisão igual faz um GET e um PATCH', async () => {
    const fetchImpl = mockFetchQueue([
      jsonResponse(gistBody({ version: 'rev-A' })),
      jsonResponse({ history: [{ version: 'rev-C' }] }),
    ]);

    const saved = await saveGistState({
      players: [{ id: 'p1' }],
      gameSessions: EMPTY,
      expectedRevision: 'version:rev-A',
      token: TOKEN,
      fetchImpl,
    });

    expect(saved.revision).toBe('version:rev-C');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1].method).toBe('PATCH');
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(Object.keys(body.files).sort()).toEqual(
      [GAME_SESSIONS_FILENAME, PLAYERS_FILENAME].sort()
    );
  });

  it('revisão diferente faz um GET e zero PATCH', async () => {
    const getToken = vi.fn(async () => TOKEN);
    const fetchImpl = mockFetchQueue([
      jsonResponse(gistBody({ version: 'rev-B' })),
      jsonResponse({ history: [{ version: 'rev-C' }] }),
    ]);

    const error = await saveGistState({
      players: [{ id: 'p1' }],
      gameSessions: EMPTY,
      expectedRevision: 'version:rev-A',
      getToken,
      fetchImpl,
    }).catch((caught) => caught);

    expect(error.code).toBe(GIST_REVISION_CONFLICT);
    expect(error.message).toBe(GIST_REVISION_CONFLICT_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('preflight faz somente o GET principal mesmo com arquivos truncados', async () => {
    const fetchImpl = mockFetchQueue([
      jsonResponse(
        gistBody({
          version: 'rev-A',
          files: {
            [PLAYERS_FILENAME]: {
              truncated: true,
              content: '[{"id":"parcial"',
              raw_url: 'https://gist.githubusercontent.com/owner/id/raw/players.json',
            },
            [GAME_SESSIONS_FILENAME]: {
              truncated: true,
              content: '{"schemaVersion":2',
              raw_url: 'https://gist.githubusercontent.com/owner/id/raw/game-sessions.json',
            },
          },
        })
      ),
      jsonResponse({ history: [{ version: 'rev-C' }] }),
    ]);

    const saved = await saveGistState({
      players: [{ id: 'p1' }],
      gameSessions: EMPTY,
      expectedRevision: 'version:rev-A',
      token: TOKEN,
      fetchImpl,
    });

    expect(saved.revision).toBe('version:rev-C');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.github.com/gists/${GIST_ID}`);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1].method).toBe('PATCH');
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('githubusercontent'))).toBe(
      false
    );
  });

  it('conflito de revisão com arquivos truncados continua com zero PATCH', async () => {
    const getToken = vi.fn(async () => TOKEN);
    const fetchImpl = mockFetchQueue([
      jsonResponse(
        gistBody({
          version: 'rev-B',
          files: {
            [PLAYERS_FILENAME]: {
              truncated: true,
              content: '[',
              raw_url: 'https://gist.githubusercontent.com/owner/id/raw/players.json',
            },
            [GAME_SESSIONS_FILENAME]: {
              truncated: true,
              content: '{',
              raw_url: 'https://gist.githubusercontent.com/owner/id/raw/game-sessions.json',
            },
          },
        })
      ),
      jsonResponse({ history: [{ version: 'rev-C' }] }),
    ]);

    const error = await saveGistState({
      players: [{ id: 'p1' }],
      gameSessions: EMPTY,
      expectedRevision: 'version:rev-A',
      getToken,
      fetchImpl,
    }).catch((caught) => caught);

    expect(error.code).toBe(GIST_REVISION_CONFLICT);
    expect(error.message).toBe(GIST_REVISION_CONFLICT_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.github.com/gists/${GIST_ID}`);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('documento inválido não faz GET nem PATCH', async () => {
    const fetchImpl = mockFetchQueue([jsonResponse(gistBody({ version: 'rev-A' }))]);
    await expect(
      saveGistState({
        players: [{ id: 'p1' }],
        gameSessions: { schemaVersion: 1, sessions: [] },
        expectedRevision: 'version:rev-A',
        token: TOKEN,
        fetchImpl,
      })
    ).rejects.toThrow('Versão de schema de encontros não suportada: 1.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('expectedRevision ausente não faz PATCH', async () => {
    const fetchImpl = mockFetchQueue([jsonResponse(gistBody({ version: 'rev-A' }))]);
    await expect(
      saveGistState({
        players: [],
        gameSessions: EMPTY,
        token: TOKEN,
        fetchImpl,
      })
    ).rejects.toThrow(GIST_EXPECTED_REVISION_REQUIRED_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('erro no preflight não faz PATCH', async () => {
    const getToken = vi.fn(async () => TOKEN);
    const fetchImpl = mockFetchQueue([jsonResponse({}, { status: 503, statusText: 'Unavailable' })]);
    await expect(
      saveGistState({
        players: [],
        gameSessions: EMPTY,
        expectedRevision: 'version:rev-A',
        getToken,
        fetchImpl,
      })
    ).rejects.toThrow('Falha ao carregar o Gist (HTTP 503 Unavailable).');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe('resolução de conflito e persistência local', () => {
  const localPlayers = [{ id: 'local' }];
  const remotePlayers = [{ id: 'remote' }];
  const localGameSessions = { schemaVersion: 2, sessions: [{ id: 'local-session' }] };
  const remoteGameSessions = { schemaVersion: 2, sessions: [{ id: 'remote-session' }] };

  it('conflito mantém dados, pendência e revisão antiga, e bloqueia novo save', () => {
    const outcome = applyGistSaveFailure({
      error: { code: GIST_REVISION_CONFLICT, message: GIST_REVISION_CONFLICT_MESSAGE },
      gistLoaded: true,
      revision: 'version:rev-A',
      hasPendingGistChanges: true,
    });

    expect(outcome.gistLoaded).toBe(false);
    expect(outcome.revision).toBe('version:rev-A');
    expect(outcome.clearRevision).toBe(false);
    expect(outcome.hasPendingGistChanges).toBe(true);
    expect(outcome.syncStatus).toBe(GIST_REVISION_CONFLICT_MESSAGE);
    expect(
      canSaveToGist({
        gistLoaded: outcome.gistLoaded,
        isSyncing: false,
        hasPassword: true,
        hasRevision: Boolean(outcome.revision),
      })
    ).toBe(false);
  });

  it('erro de rede no preflight não é tratado como conflito', () => {
    const outcome = applyGistSaveFailure({
      error: new Error('Falha ao carregar o Gist (HTTP 503 Unavailable).'),
      gistLoaded: true,
      revision: 'version:rev-A',
      hasPendingGistChanges: true,
    });

    expect(outcome.gistLoaded).toBe(true);
    expect(outcome.revision).toBe('version:rev-A');
    expect(outcome.hasPendingGistChanges).toBe(true);
    expect(outcome.syncStatus).toContain('Erro ao salvar:');
    expect(outcome.syncStatus).not.toContain(GIST_REVISION_CONFLICT_MESSAGE);
  });

  it('cancelar mantém o bloqueio e a revisão antiga', () => {
    const afterConflict = applyGistSaveFailure({
      error: { code: GIST_REVISION_CONFLICT, message: GIST_REVISION_CONFLICT_MESSAGE },
      gistLoaded: true,
      revision: 'version:rev-A',
      hasPendingGistChanges: true,
    });
    expect(gistLoadNeedsFetch(GIST_LOAD_STRATEGY.CANCEL)).toBe(false);
    expect(afterConflict.gistLoaded).toBe(false);
    expect(afterConflict.revision).toBe('version:rev-A');
  });

  it('manter locais captura a revisão nova e avisa substituição remota', () => {
    const keep = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.KEEP_LOCAL,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
    });
    const remoteRevision = 'version:rev-B';

    expect(keep.replaceLocal).toBe(false);
    expect(keep.players).toBe(localPlayers);
    expect(keep.gameSessions).toBe(localGameSessions);
    expect(keep.gistLoaded).toBe(true);
    expect(keep.hasPendingGistChanges).toBe(true);
    expect(keep.syncStatus).toBe(GIST_KEEP_LOCAL_MESSAGE);
    expect(
      canSaveToGist({
        gistLoaded: true,
        isSyncing: false,
        hasPassword: true,
        hasRevision: Boolean(remoteRevision),
      })
    ).toBe(true);
  });

  it('usar remoto captura a revisão nova e limpa pendência em V2', () => {
    const useRemote = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.USE_REMOTE,
      localPlayers,
      localGameSessions,
      remotePlayers,
      remoteGameSessions,
      remoteMigrated: false,
    });

    expect(useRemote.replaceLocal).toBe(true);
    expect(useRemote.players).toBe(remotePlayers);
    expect(useRemote.hasPendingGistChanges).toBe(false);
    expect(useRemote.gistLoaded).toBe(true);
  });

  it('PATCH bem-sucedido atualiza revisão e limpa pendência', () => {
    const outcome = applyGistSaveSuccess({ revision: 'version:rev-C' });
    expect(outcome.gistLoaded).toBe(true);
    expect(outcome.revision).toBe('version:rev-C');
    expect(outcome.hasPendingGistChanges).toBe(false);
    expect(outcome.syncStatus).toBe('Salvo no Gist com sucesso!');
  });

  it('PATCH sem revisão mantém pendência e exige novo GET', () => {
    const outcome = applyGistSaveSuccess({ revision: null });
    expect(outcome.gistLoaded).toBe(false);
    expect(outcome.revision).toBeNull();
    expect(outcome.clearRevision).toBe(true);
    expect(outcome.hasPendingGistChanges).toBe(true);
    expect(outcome.syncStatus).toBe(GIST_SAVE_REVISION_UNCONFIRMED_MESSAGE);
    expect(
      canSaveToGist({
        gistLoaded: outcome.gistLoaded,
        isSyncing: false,
        hasPassword: true,
        hasRevision: Boolean(outcome.revision),
      })
    ).toBe(false);
  });
});

describe('cenário de dois dispositivos', () => {
  it('bloqueia o PATCH na revisão B e só salva depois de manter locais', async () => {
    const localPlayers = [{ id: 'device-a' }];
    const localGameSessions = {
      schemaVersion: 2,
      sessions: [{ id: 'changed-locally' }],
    };

    const loadedA = await loadGistState({
      fetchImpl: mockFetchQueue([jsonResponse(gistBody({ version: 'A' }))]),
    });
    expect(loadedA.revision).toBe('version:A');

    const getToken = vi.fn(async () => TOKEN);
    const conflictFetch = mockFetchQueue([
      jsonResponse(gistBody({ version: 'B' })),
      jsonResponse({ history: [{ version: 'C' }] }),
    ]);
    const conflict = await saveGistState({
      players: localPlayers,
      gameSessions: EMPTY,
      expectedRevision: loadedA.revision,
      getToken,
      fetchImpl: conflictFetch,
    }).catch((caught) => caught);

    expect(conflict.code).toBe(GIST_REVISION_CONFLICT);
    expect(conflictFetch).toHaveBeenCalledTimes(1);
    expect(getToken).not.toHaveBeenCalled();

    const blocked = applyGistSaveFailure({
      error: conflict,
      gistLoaded: true,
      revision: loadedA.revision,
      hasPendingGistChanges: true,
    });
    expect(blocked.gistLoaded).toBe(false);
    expect(blocked.revision).toBe('version:A');
    expect(blocked.hasPendingGistChanges).toBe(true);

    const reloaded = await loadGistState({
      fetchImpl: mockFetchQueue([jsonResponse(gistBody({ version: 'B' }))]),
    });
    const keepLocal = applySuccessfulGistLoad({
      strategy: GIST_LOAD_STRATEGY.KEEP_LOCAL,
      localPlayers,
      localGameSessions,
      remotePlayers: reloaded.players,
      remoteGameSessions: reloaded.gameSessions,
    });
    expect(reloaded.revision).toBe('version:B');
    expect(keepLocal.replaceLocal).toBe(false);
    expect(keepLocal.gameSessions).toBe(localGameSessions);
    expect(keepLocal.hasPendingGistChanges).toBe(true);

    const saveFetch = mockFetchQueue([
      jsonResponse(gistBody({ version: 'B' })),
      jsonResponse({ history: [{ version: 'C' }] }),
    ]);
    const saved = await saveGistState({
      players: localPlayers,
      gameSessions: EMPTY,
      expectedRevision: reloaded.revision,
      getToken,
      fetchImpl: saveFetch,
    });
    expect(saveFetch).toHaveBeenCalledTimes(2);
    expect(saveFetch.mock.calls[1][1].method).toBe('PATCH');
    expect(saved.revision).toBe('version:C');

    const afterSave = applyGistSaveSuccess({ revision: saved.revision });
    expect(afterSave.revision).toBe('version:C');
    expect(afterSave.hasPendingGistChanges).toBe(false);
    expect(afterSave.gistLoaded).toBe(true);
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});

describe('lock de GET + PATCH', () => {
  it('dois cliques não duplicam GET/PATCH', async () => {
    const lock = createSyncLock();
    const fetchImpl = vi.fn(async (_url, options = {}) => {
      if (!options.method) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return jsonResponse(gistBody({ version: 'A' }));
      }
      return jsonResponse({ history: [{ version: 'C' }] });
    });

    const save = () =>
      saveGistState({
        players: [],
        gameSessions: EMPTY,
        expectedRevision: 'version:A',
        token: TOKEN,
        fetchImpl,
      });

    const first = runExclusiveSync(lock, save);
    const second = await runExclusiveSync(lock, save);
    const firstResult = await first;

    expect(second.started).toBe(false);
    expect(firstResult.started).toBe(true);
    expect(firstResult.result.revision).toBe('version:C');
    expect(fetchImpl.mock.calls.filter(([, options]) => !options?.method).length).toBe(1);
    expect(fetchImpl.mock.calls.filter(([, options]) => options?.method === 'PATCH').length).toBe(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.github.com/gists/${GIST_ID}`);
  });
});
