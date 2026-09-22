import { describe, expect, it, vi } from 'vitest';
import {
  assertGistRawUrl,
  GIST_RAW_HOST,
  GIST_RAW_URL_HOST_MESSAGE,
  GIST_RAW_URL_HTTPS_MESSAGE,
  GIST_RAW_URL_REQUIRED_MESSAGE,
  readGistFileContent,
} from './gistFileContent.js';
import { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from '../../persistence/constants.js';

const RAW_PLAYERS =
  'https://gist.githubusercontent.com/owner/id/raw/rev/players.json';
const RAW_SESSIONS =
  'https://gist.githubusercontent.com/owner/id/raw/rev/game-sessions.json';

function textResponse(text, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: vi.fn(async () => text),
    json: vi.fn(async () => {
      throw new Error('json() não deve ser chamado no GET raw');
    }),
  };
}

describe('assertGistRawUrl', () => {
  it('aceita HTTPS em gist.githubusercontent.com', () => {
    expect(assertGistRawUrl(RAW_PLAYERS)).toBe(RAW_PLAYERS);
  });

  it('rejeita URL ausente', () => {
    expect(() => assertGistRawUrl(undefined)).toThrow(GIST_RAW_URL_REQUIRED_MESSAGE);
    expect(() => assertGistRawUrl('')).toThrow(GIST_RAW_URL_REQUIRED_MESSAGE);
    expect(() => assertGistRawUrl('   ')).toThrow(GIST_RAW_URL_REQUIRED_MESSAGE);
  });

  it('rejeita URL inválida', () => {
    expect(() => assertGistRawUrl('not a url')).toThrow(GIST_RAW_URL_REQUIRED_MESSAGE);
  });

  it('rejeita protocolo que não é HTTPS', () => {
    expect(() =>
      assertGistRawUrl('http://gist.githubusercontent.com/owner/id/raw/rev/players.json')
    ).toThrow(GIST_RAW_URL_HTTPS_MESSAGE);
  });

  it('rejeita hostname diferente', () => {
    expect(() => assertGistRawUrl('https://example.com/raw/players.json')).toThrow(
      GIST_RAW_URL_HOST_MESSAGE
    );
    expect(() =>
      assertGistRawUrl('https://gist.githubusercontent.com.evil.test/raw/players.json')
    ).toThrow(GIST_RAW_URL_HOST_MESSAGE);
    expect(GIST_RAW_HOST).toBe('gist.githubusercontent.com');
  });
});

describe('readGistFileContent', () => {
  it('arquivo ausente devolve undefined sem fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(readGistFileContent({}, PLAYERS_FILENAME, { fetchImpl })).resolves.toBeUndefined();
    await expect(
      readGistFileContent({ [PLAYERS_FILENAME]: null }, PLAYERS_FILENAME, { fetchImpl })
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('arquivo normal usa content', async () => {
    const fetchImpl = vi.fn();
    await expect(
      readGistFileContent(
        { [PLAYERS_FILENAME]: { truncated: false, content: '[{"id":"p1"}]' } },
        PLAYERS_FILENAME,
        { fetchImpl }
      )
    ).resolves.toBe('[{"id":"p1"}]');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('arquivo truncado usa raw_url e ignora content parcial', async () => {
    const rawBody = JSON.stringify([{ id: 'full' }]);
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe(RAW_PLAYERS);
      return textResponse(rawBody);
    });

    const content = await readGistFileContent(
      {
        [PLAYERS_FILENAME]: {
          truncated: true,
          content: '[{"id":"partial"',
          raw_url: RAW_PLAYERS,
        },
      },
      PLAYERS_FILENAME,
      { fetchImpl }
    );

    expect(content).toBe(rawBody);
    expect(content).not.toContain('partial');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toBeUndefined();
  });

  it('truncado sem raw_url gera erro e não faz GET', async () => {
    const fetchImpl = vi.fn();
    await expect(
      readGistFileContent(
        {
          [PLAYERS_FILENAME]: { truncated: true, content: '[{"id":"partial"' },
        },
        PLAYERS_FILENAME,
        { fetchImpl }
      )
    ).rejects.toThrow(GIST_RAW_URL_REQUIRED_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('truncado com HTTP recusa ler o corpo', async () => {
    const fetchImpl = vi.fn();
    await expect(
      readGistFileContent(
        {
          [GAME_SESSIONS_FILENAME]: {
            truncated: true,
            content: '{}',
            raw_url: 'http://gist.githubusercontent.com/owner/id/raw/game-sessions.json',
          },
        },
        GAME_SESSIONS_FILENAME,
        { fetchImpl }
      )
    ).rejects.toThrow(GIST_RAW_URL_HTTPS_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('truncado com hostname inválido não faz GET', async () => {
    const fetchImpl = vi.fn();
    await expect(
      readGistFileContent(
        {
          [PLAYERS_FILENAME]: {
            truncated: true,
            raw_url: 'https://api.github.com/gists/raw/players.json',
          },
        },
        PLAYERS_FILENAME,
        { fetchImpl }
      )
    ).rejects.toThrow(GIST_RAW_URL_HOST_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('raw GET 404 não lê o texto', async () => {
    const response = textResponse('should-not-read', { status: 404, statusText: 'Not Found' });
    const fetchImpl = vi.fn(async () => response);

    await expect(
      readGistFileContent(
        { [PLAYERS_FILENAME]: { truncated: true, raw_url: RAW_PLAYERS } },
        PLAYERS_FILENAME,
        { fetchImpl }
      )
    ).rejects.toThrow('Falha ao carregar o arquivo raw do Gist (HTTP 404 Not Found).');

    expect(response.text).not.toHaveBeenCalled();
  });

  it('raw GET 500 não lê o texto', async () => {
    const response = textResponse('should-not-read', {
      status: 500,
      statusText: 'Internal Server Error',
    });
    const fetchImpl = vi.fn(async () => response);

    await expect(
      readGistFileContent(
        { [GAME_SESSIONS_FILENAME]: { truncated: true, raw_url: RAW_SESSIONS } },
        GAME_SESSIONS_FILENAME,
        { fetchImpl }
      )
    ).rejects.toThrow(
      'Falha ao carregar o arquivo raw do Gist (HTTP 500 Internal Server Error).'
    );
    expect(response.text).not.toHaveBeenCalled();
  });
});
