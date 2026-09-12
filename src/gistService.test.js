import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GIST_ID,
  loadGistState,
  loadPlayersFromGist,
  patchGistFiles,
  saveGistState,
  savePlayersToGist,
} from './gistService.js';
import { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from './persistence/constants.js';
import { createEmptyGameSessionsDocument } from './persistence/gameSessionsDocument.js';

const TOKEN = 'ghp_test_token_secret';

function jsonResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  };
}

function gistPayload(files) {
  return { files };
}

function mockFetch(response) {
  return vi.fn(async () => response);
}

function captureConsole() {
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const spies = methods.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args) => {
      lines.push(args.map(String).join(' '));
    })
  );
  return {
    lines,
    restore() {
      spies.forEach((spy) => spy.mockRestore());
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadGistState', () => {
  it('faz um único GET e lê os dois arquivos pelo nome', async () => {
    const players = [{ id: 'p1', name: 'Erik' }];
    const gameSessions = {
      schemaVersion: 1,
      sessions: [{ id: 's1' }],
    };
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify(players) },
          [GAME_SESSIONS_FILENAME]: { content: JSON.stringify(gameSessions) },
          'notes.txt': { content: 'ignore-me' },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.github.com/gists/${GIST_ID}`);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(state).toEqual({ players, gameSessions });
  });

  it('retorna array vazio quando players.json está ausente', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [GAME_SESSIONS_FILENAME]: {
            content: JSON.stringify({ schemaVersion: 1, sessions: [{ id: 's1' }] }),
          },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual([]);
    expect(state.gameSessions.sessions).toEqual([{ id: 's1' }]);
  });

  it('retorna documento vazio quando game-sessions.json está ausente', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify([{ id: 'p1' }]) },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual([{ id: 'p1' }]);
    expect(state.gameSessions).toEqual(createEmptyGameSessionsDocument());
  });

  it('não usa o primeiro arquivo disponível como players.json', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          'zzz-other.json': { content: JSON.stringify([{ id: 'should-not-load' }]) },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual([]);
    expect(state.gameSessions).toEqual(createEmptyGameSessionsDocument());
  });

  it('trata conteúdo vazio como arquivo ausente', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: '   ' },
          [GAME_SESSIONS_FILENAME]: { content: '' },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual([]);
    expect(state.gameSessions).toEqual(createEmptyGameSessionsDocument());
  });

  it('identifica JSON inválido em players.json', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: '{not-json' },
        })
      )
    );

    await expect(loadGistState({ fetchImpl })).rejects.toThrow('JSON inválido em players.json.');
  });

  it('identifica JSON inválido em game-sessions.json', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [GAME_SESSIONS_FILENAME]: { content: '{not-json' },
        })
      )
    );

    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'JSON inválido em game-sessions.json.'
    );
  });

  it('rejeita players.json que não contém array', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: '{"id":"p1"}' },
        })
      )
    );

    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'players.json precisa conter um array.'
    );
  });

  it('rejeita schema inválido de encontros', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [GAME_SESSIONS_FILENAME]: {
            content: JSON.stringify({ schemaVersion: 9, sessions: [] }),
          },
        })
      )
    );

    await expect(loadGistState({ fetchImpl })).rejects.toThrow('game-sessions.json');
    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'Versão de schema de encontros não suportada: 9.'
    );
  });

  it('propaga erro HTTP no GET', async () => {
    const fetchImpl = mockFetch(jsonResponse({}, { status: 404, statusText: 'Not Found' }));
    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'Falha ao carregar o Gist (HTTP 404 Not Found).'
    );
  });

  it('mantém o wrapper loadPlayersFromGist', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify([{ id: 'p1' }]) },
        })
      )
    );
    await expect(loadPlayersFromGist({ fetchImpl })).resolves.toEqual([{ id: 'p1' }]);
  });

  it('loadPlayersFromGist ignora game-sessions.json inválido', async () => {
    const players = [{ id: 'p1', name: 'Erik' }];
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify(players) },
          [GAME_SESSIONS_FILENAME]: { content: '{not-json' },
        })
      )
    );

    await expect(loadPlayersFromGist({ fetchImpl })).resolves.toEqual(players);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('loadGistState rejeita o mesmo payload com game-sessions.json inválido', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify([{ id: 'p1', name: 'Erik' }]) },
          [GAME_SESSIONS_FILENAME]: { content: '{not-json' },
        })
      )
    );

    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'JSON inválido em game-sessions.json.'
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('patchGistFiles e saveGistState', () => {
  it('salva os dois arquivos em um único PATCH', async () => {
    const players = [{ id: 'p1' }];
    const gameSessions = createEmptyGameSessionsDocument();
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));

    await saveGistState({ players, gameSessions, token: TOKEN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body);
    expect(Object.keys(body.files).sort()).toEqual(
      [GAME_SESSIONS_FILENAME, PLAYERS_FILENAME].sort()
    );
    expect(JSON.parse(body.files[PLAYERS_FILENAME].content)).toEqual(players);
    expect(JSON.parse(body.files[GAME_SESSIONS_FILENAME].content)).toEqual(gameSessions);
  });

  it('permite PATCH com somente um arquivo e omite os demais', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));
    await patchGistFiles(
      { [GAME_SESSIONS_FILENAME]: createEmptyGameSessionsDocument() },
      TOKEN,
      { fetchImpl }
    );

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.files).toHaveProperty(GAME_SESSIONS_FILENAME);
    expect(body.files).not.toHaveProperty(PLAYERS_FILENAME);
  });

  it('rejeita null e undefined para não apagar arquivos no Gist', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));

    await expect(
      patchGistFiles({ [PLAYERS_FILENAME]: null }, TOKEN, { fetchImpl })
    ).rejects.toThrow('Não é permitido enviar players.json como null ou undefined.');

    await expect(
      patchGistFiles({ [GAME_SESSIONS_FILENAME]: undefined }, TOKEN, { fetchImpl })
    ).rejects.toThrow('Não é permitido enviar game-sessions.json como null ou undefined.');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exige token', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));
    await expect(
      patchGistFiles({ [PLAYERS_FILENAME]: [] }, '', { fetchImpl })
    ).rejects.toThrow('GitHub Personal Access Token is required to save.');
    await expect(
      saveGistState({
        players: [],
        gameSessions: createEmptyGameSessionsDocument(),
        fetchImpl,
      })
    ).rejects.toThrow('GitHub Personal Access Token is required to save.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propaga erro HTTP no PATCH', async () => {
    const fetchImpl = mockFetch(jsonResponse({}, { status: 401, statusText: 'Unauthorized' }));
    await expect(
      patchGistFiles({ [PLAYERS_FILENAME]: [] }, TOKEN, { fetchImpl })
    ).rejects.toThrow('Falha ao atualizar o Gist (HTTP 401 Unauthorized).');
  });

  it('não registra o token em logs', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));
    const consoleCapture = captureConsole();

    try {
      await saveGistState({
        players: [],
        gameSessions: createEmptyGameSessionsDocument(),
        token: TOKEN,
        fetchImpl,
      });
      await patchGistFiles({ [PLAYERS_FILENAME]: [] }, TOKEN, { fetchImpl });
    } finally {
      consoleCapture.restore();
    }

    expect(consoleCapture.lines.join('\n')).not.toContain(TOKEN);
  });

  it('mantém o wrapper savePlayersToGist sem incluir game-sessions.json', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));
    await savePlayersToGist([{ id: 'p1' }], TOKEN, { fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(Object.keys(body.files)).toEqual([PLAYERS_FILENAME]);
  });
});
