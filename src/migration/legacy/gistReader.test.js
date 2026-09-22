import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GIST_ID,
  loadGistState,
  loadPlayersFromGist,
} from './gistReader.js';
import { COMPETITIONS_FILENAME, GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from '../../persistence/constants.js';
import {
  createEmptyGameSessionsDocument,
} from '../../persistence/gameSessionsDocument.js';
import {
  createEmptyCompetitionDocument,
} from '../../persistence/competitionsDocument.js';

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
