import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GIST_EXPECTED_REVISION_REQUIRED_MESSAGE,
  GIST_ID,
  loadGistState,
  loadPlayersFromGist,
  patchGistFiles,
  saveGistState,
  savePlayersToGist,
} from './gistService.js';
import { COMPETITIONS_FILENAME, GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from './persistence/constants.js';
import {
  createEmptyGameSessionsDocument,
  serializeGameSessionsDocument,
} from './persistence/gameSessionsDocument.js';
import {
  createEmptyCompetitionDocument,
  serializeCompetitionsDocument,
} from './persistence/competitionsDocument.js';

const TOKEN = 'ghp_test_token_secret';
const ISO = '2026-09-12T18:00:00.000Z';

function v1DraftSession(id = 's1') {
  return {
    id,
    date: '2026-09-12',
    name: null,
    status: 'draft',
    createdAt: ISO,
    updatedAt: ISO,
    pairs: [],
    rounds: [],
  };
}

function jsonResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  };
}

function gistPayload(files, extras = {}) {
  const payload = { files, ...extras };
  if (!Object.prototype.hasOwnProperty.call(payload, 'history') && payload.updated_at == null) {
    payload.history = [{ version: 'rev-test' }];
  }
  return payload;
}

function mockFetch(response) {
  return vi.fn(async () => response);
}

function mockFetchQueue(responses) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (next == null) {
      throw new Error('fetch inesperado');
    }
    return typeof next === 'function' ? next() : next;
  });
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
  it('GET V1 migra para V2 e informa migrated: true', async () => {
    const players = [{ id: 'p1', name: 'Erik' }];
    const gameSessions = {
      schemaVersion: 1,
      sessions: [v1DraftSession()],
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
    expect(state.players).toEqual(players);
    expect(state.migrated).toBe(true);
    expect(state.sourceVersion).toBe(1);
    expect(state.gameSessions.schemaVersion).toBe(2);
    expect(state.gameSessions.sessions[0]).toMatchObject({
      id: 's1',
      format: { teamSize: 2, teamCount: 2 },
      teams: [],
      rounds: [],
    });
    expect(state.gameSessions.sessions[0]).not.toHaveProperty('pairs');
    expect(state.revision).toBe('version:rev-test');
  });

  it('GET V2 valida sem migrar', async () => {
    const players = [{ id: 'p1', name: 'Erik' }];
    const gameSessions = { schemaVersion: 2, sessions: [] };
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify(players) },
          [GAME_SESSIONS_FILENAME]: { content: JSON.stringify(gameSessions) },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual(players);
    expect(state.migrated).toBe(false);
    expect(state.sourceVersion).toBe(2);
    expect(state.gameSessions).toEqual(createEmptyGameSessionsDocument());
    expect(state.competitions).toEqual(createEmptyCompetitionDocument());
    expect(state.revision).toBe('version:rev-test');
  });

  it('retorna array vazio quando players.json está ausente e ainda migra encontros V1', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [GAME_SESSIONS_FILENAME]: {
            content: JSON.stringify({ schemaVersion: 1, sessions: [v1DraftSession()] }),
          },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual([]);
    expect(state.migrated).toBe(true);
    expect(state.gameSessions.sessions[0].id).toBe('s1');
    expect(state.gameSessions.schemaVersion).toBe(2);
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
    expect(state.competitions).toEqual(createEmptyCompetitionDocument());
    expect(state.migrated).toBe(false);
    expect(state.sourceVersion).toBeNull();
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
    expect(state.competitions).toEqual(createEmptyCompetitionDocument());
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
    expect(state.competitions).toEqual(createEmptyCompetitionDocument());
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

  it('Gist antigo sem competitions.json carrega documento vazio', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify([{ id: 'p1' }]) },
          [GAME_SESSIONS_FILENAME]: {
            content: JSON.stringify({ schemaVersion: 2, sessions: [] }),
          },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.competitions).toEqual(createEmptyCompetitionDocument());
    expect(state.competitionsSourceVersion).toBeNull();
    expect(state.gameSessions).toEqual(createEmptyGameSessionsDocument());
  });

  it('lê competitions.json válido', async () => {
    const competitions = {
      schemaVersion: 1,
      competitions: [
        {
          id: 'c1',
          name: 'Open',
          status: 'draft',
          createdAt: ISO,
          updatedAt: ISO,
          format: { teamSize: 2 },
          tournamentType: 'single_elimination',
          teams: [],
          rounds: [],
        },
      ],
    };
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [COMPETITIONS_FILENAME]: { content: JSON.stringify(competitions) },
        })
      )
    );

    const state = await loadGistState({ fetchImpl });
    expect(state.competitions.schemaVersion).toBe(2);
    expect(state.competitions.competitions[0]).toMatchObject({
      id: 'c1',
      name: 'Open',
      status: 'draft',
    });
    expect(state.competitions.competitions[0].stages[0]).toMatchObject({
      type: 'single_elimination',
      status: 'pending',
      rounds: [],
    });
    expect(state.competitionsSourceVersion).toBe(1);
    expect(state.migrated).toBe(true);
  });

  it('identifica JSON inválido em competitions.json', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        gistPayload({
          [COMPETITIONS_FILENAME]: { content: '{not-json' },
        })
      )
    );

    await expect(loadGistState({ fetchImpl })).rejects.toThrow('JSON inválido em competitions.json.');
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

describe('arquivos truncados pela API', () => {
  const RAW_PLAYERS = 'https://gist.githubusercontent.com/owner/id/raw/rev/players.json';
  const RAW_SESSIONS = 'https://gist.githubusercontent.com/owner/id/raw/rev/game-sessions.json';
  const gistApiUrl = `https://api.github.com/gists/${GIST_ID}`;

  function textResponse(text, { status = 200, statusText = 'OK' } = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      text: vi.fn(async () => text),
      json: async () => {
        throw new Error('json() não deve ser chamado no GET raw');
      },
    };
  }

  function mockGistAndRaw({ gist, raw = {} }) {
    return vi.fn(async (url) => {
      const href = String(url);
      if (href === gistApiUrl) return gist;
      if (Object.prototype.hasOwnProperty.call(raw, href)) return raw[href];
      throw new Error(`fetch inesperado: ${href}`);
    });
  }

  it('players.json truncado usa raw_url e ignora content parcial', async () => {
    const players = [{ id: 'p1', name: 'Erik' }];
    const fetchImpl = mockGistAndRaw({
      gist: jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: {
            truncated: true,
            content: '[{"id":"parcial"',
            raw_url: RAW_PLAYERS,
          },
          [GAME_SESSIONS_FILENAME]: {
            content: JSON.stringify({ schemaVersion: 2, sessions: [] }),
          },
        })
      ),
      raw: { [RAW_PLAYERS]: textResponse(JSON.stringify(players)) },
    });

    const state = await loadGistState({ fetchImpl });
    expect(state.players).toEqual(players);
    expect(state.revision).toBe('version:rev-test');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(gistApiUrl);
    expect(fetchImpl.mock.calls[1][0]).toBe(RAW_PLAYERS);
  });

  it('game-sessions.json truncado usa JSON completo válido do raw', async () => {
    const gameSessions = { schemaVersion: 2, sessions: [] };
    const fetchImpl = mockGistAndRaw({
      gist: jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: { content: JSON.stringify([{ id: 'p1' }]) },
          [GAME_SESSIONS_FILENAME]: {
            truncated: true,
            content: '{"schemaVersion":2',
            raw_url: RAW_SESSIONS,
          },
        })
      ),
      raw: { [RAW_SESSIONS]: textResponse(JSON.stringify(gameSessions)) },
    });

    const state = await loadGistState({ fetchImpl });
    expect(state.gameSessions).toEqual(createEmptyGameSessionsDocument());
    expect(state.migrated).toBe(false);
    expect(state.sourceVersion).toBe(2);
    expect(state.revision).toBe('version:rev-test');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([gistApiUrl, RAW_SESSIONS]);
  });

  it('rejeita JSON raw inválido de players.json', async () => {
    const fetchImpl = mockGistAndRaw({
      gist: jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: {
            truncated: true,
            content: '[{"id":"parcial"',
            raw_url: RAW_PLAYERS,
          },
        })
      ),
      raw: { [RAW_PLAYERS]: textResponse('{not-json') },
    });

    await expect(loadGistState({ fetchImpl })).rejects.toThrow('JSON inválido em players.json.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejeita JSON raw inválido de game-sessions.json', async () => {
    const fetchImpl = mockGistAndRaw({
      gist: jsonResponse(
        gistPayload({
          [GAME_SESSIONS_FILENAME]: {
            truncated: true,
            content: '{"schemaVersion":2',
            raw_url: RAW_SESSIONS,
          },
        })
      ),
      raw: { [RAW_SESSIONS]: textResponse('{not-json') },
    });

    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'JSON inválido em game-sessions.json.'
    );
  });

  it('arquivo truncado ausente de raw_url não cai no primeiro arquivo', async () => {
    const fetchImpl = mockGistAndRaw({
      gist: jsonResponse(
        gistPayload({
          'other.json': { content: JSON.stringify([{ id: 'should-not-load' }]) },
          [PLAYERS_FILENAME]: { truncated: true, content: '[{"id":"parcial"' },
        })
      ),
      raw: {},
    });

    await expect(loadGistState({ fetchImpl })).rejects.toThrow(
      'A URL raw do arquivo do Gist está ausente ou é inválida.'
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('loadPlayersFromGist busca raw só de players.json truncado', async () => {
    const players = [{ id: 'p1' }];
    const fetchImpl = mockGistAndRaw({
      gist: jsonResponse(
        gistPayload({
          [PLAYERS_FILENAME]: {
            truncated: true,
            content: '[',
            raw_url: RAW_PLAYERS,
          },
          [GAME_SESSIONS_FILENAME]: {
            truncated: true,
            content: '{',
            raw_url: RAW_SESSIONS,
          },
        })
      ),
      raw: { [RAW_PLAYERS]: textResponse(JSON.stringify(players)) },
    });

    await expect(loadPlayersFromGist({ fetchImpl })).resolves.toEqual(players);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([gistApiUrl, RAW_PLAYERS]);
  });
});

describe('patchGistFiles e saveGistState', () => {
  it('salva os dois arquivos em um único PATCH depois do GET de preflight', async () => {
    const players = [{ id: 'p1' }];
    const gameSessions = createEmptyGameSessionsDocument();
    const fetchImpl = mockFetchQueue([
      jsonResponse(gistPayload({})),
      jsonResponse({ id: GIST_ID, history: [{ version: 'rev-after' }] }),
    ]);

    const saved = await saveGistState({
      players,
      gameSessions,
      expectedRevision: 'version:rev-test',
      token: TOKEN,
      fetchImpl,
    });

    expect(saved.revision).toBe('version:rev-after');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1].method).toBe('PATCH');
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(Object.keys(body.files).sort()).toEqual(
      [COMPETITIONS_FILENAME, GAME_SESSIONS_FILENAME, PLAYERS_FILENAME].sort()
    );
    expect(JSON.parse(body.files[PLAYERS_FILENAME].content)).toEqual(players);
    expect(body.files[GAME_SESSIONS_FILENAME].content).toBe(
      serializeGameSessionsDocument(gameSessions)
    );
    expect(JSON.parse(body.files[GAME_SESSIONS_FILENAME].content)).toEqual(gameSessions);
    expect(body.files[COMPETITIONS_FILENAME].content).toBe(
      serializeCompetitionsDocument(createEmptyCompetitionDocument())
    );
  });

  it('rejeita PATCH de documento V1 antes do fetch e deixa players.json intacto', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));

    await expect(
      saveGistState({
        players: [{ id: 'p1', name: 'Erik' }],
        gameSessions: { schemaVersion: 1, sessions: [] },
        token: TOKEN,
        fetchImpl,
      })
    ).rejects.toThrow('Versão de schema de encontros não suportada: 1.');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejeita PATCH de documento V2 inválido antes do fetch', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));

    await expect(
      saveGistState({
        players: [{ id: 'p1', name: 'Erik' }],
        gameSessions: {
          schemaVersion: 2,
          sessions: [
            {
              id: 's1',
              date: '2026-09-12',
              name: null,
              status: 'archived',
              createdAt: ISO,
              updatedAt: ISO,
              format: { teamSize: 2, teamCount: 2 },
              teams: [],
              rounds: [],
            },
          ],
        },
        token: TOKEN,
        fetchImpl,
      })
    ).rejects.toThrow('O status do encontro precisa ser rascunho, em andamento ou finalizado.');

    expect(fetchImpl).not.toHaveBeenCalled();
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

  it('exige revisão esperada antes de qualquer fetch', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: GIST_ID }));
    await expect(
      patchGistFiles({ [PLAYERS_FILENAME]: [] }, '', { fetchImpl })
    ).rejects.toThrow('GitHub Personal Access Token is required to save.');
    await expect(
      saveGistState({
        players: [],
        gameSessions: createEmptyGameSessionsDocument(),
        token: TOKEN,
        fetchImpl,
      })
    ).rejects.toThrow(GIST_EXPECTED_REVISION_REQUIRED_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propaga erro HTTP no PATCH', async () => {
    const fetchImpl = mockFetch(jsonResponse({}, { status: 401, statusText: 'Unauthorized' }));
    await expect(
      patchGistFiles({ [PLAYERS_FILENAME]: [] }, TOKEN, { fetchImpl })
    ).rejects.toThrow('Falha ao atualizar o Gist (HTTP 401 Unauthorized).');
  });

  it('não registra o token em logs', async () => {
    const fetchImpl = mockFetchQueue([
      jsonResponse(gistPayload({})),
      jsonResponse({ id: GIST_ID, history: [{ version: 'rev-after' }] }),
      jsonResponse({ id: GIST_ID }),
    ]);
    const consoleCapture = captureConsole();

    try {
      await saveGistState({
        players: [],
        gameSessions: createEmptyGameSessionsDocument(),
        expectedRevision: 'version:rev-test',
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
