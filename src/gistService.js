import { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from './persistence/constants.js';
import {
  createEmptyGameSessionsDocument,
  interpretGameSessionsJson,
  serializeGameSessionsDocument,
  validateGameSessionsDocument,
} from './persistence/gameSessionsDocument.js';
import { readGistFileContent } from './gistFileContent.js';
import {
  extractGistRevision,
  GIST_EXPECTED_REVISION_REQUIRED_MESSAGE,
  GistRevisionConflictError,
} from './gistRevision.js';

export const GIST_ID = '58f047706f0f4c48bc83b18aab5e5949';
export const DEFAULT_FILENAME = PLAYERS_FILENAME;
export const ENCRYPTED_GITHUB_TOKEN = 'Dh4mcqVeMAbw4SEOao+YGy+FZy6eEzQDxZ3fu30e3XuRWA7d/GATh9n0dQASmvfH5DLwOCJT+uak41sEDSPlolIN1NyCsqBc0olt7GkR7mIUStS1dFTA+cjZmaBlAtmPDOqFrxsA4LsnrxES85OWKKxxjUdoWWFDuQ==';

export { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME };
export {
  extractGistRevision,
  GIST_EXPECTED_REVISION_REQUIRED_MESSAGE,
  GIST_REVISION_CONFLICT,
  GIST_REVISION_CONFLICT_MESSAGE,
  GIST_REVISION_MISSING_MESSAGE,
  GistRevisionConflictError,
  isGistRevisionConflict,
} from './gistRevision.js';

function gistUrl() {
  return `https://api.github.com/gists/${GIST_ID}`;
}

function resolveFetch(fetchImpl) {
  return fetchImpl ?? fetch;
}

function assertOk(response, action) {
  if (response.ok) return;
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  throw new Error(`Falha ao ${action} o Gist (HTTP ${response.status}${statusText}).`);
}

function isBlankContent(content) {
  return content == null || (typeof content === 'string' && content.trim() === '');
}

function parsePlayersContent(content) {
  if (isBlankContent(content)) return [];

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('JSON inválido em players.json.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('players.json precisa conter um array.');
  }

  return parsed;
}

function parseGameSessionsContent(content) {
  if (isBlankContent(content)) {
    return {
      document: createEmptyGameSessionsDocument(),
      migrated: false,
      sourceVersion: null,
    };
  }

  try {
    JSON.parse(content);
  } catch {
    throw new Error('JSON inválido em game-sessions.json.');
  }

  try {
    return interpretGameSessionsJson(content);
  } catch (error) {
    throw new Error(`Arquivo game-sessions.json inválido: ${error.message}`);
  }
}

function isUsableRevision(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function fetchGist(fetchImpl) {
  const response = await resolveFetch(fetchImpl)(gistUrl(), {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });

  assertOk(response, 'carregar');

  const data = await response.json();
  return {
    files: data.files ?? {},
    revision: extractGistRevision(data),
  };
}

export async function loadGistState({ fetchImpl } = {}) {
  const { files, revision } = await fetchGist(fetchImpl);
  const playersContent = await readGistFileContent(files, PLAYERS_FILENAME, { fetchImpl });
  const sessionsContent = await readGistFileContent(files, GAME_SESSIONS_FILENAME, {
    fetchImpl,
  });
  const sessions = parseGameSessionsContent(sessionsContent);

  return {
    players: parsePlayersContent(playersContent),
    gameSessions: sessions.document,
    migrated: sessions.migrated,
    sourceVersion: sessions.sourceVersion,
    revision,
  };
}

export async function patchGistFiles(fileMap, token, { fetchImpl } = {}) {
  if (!token) {
    throw new Error('GitHub Personal Access Token is required to save.');
  }

  if (fileMap == null || typeof fileMap !== 'object' || Array.isArray(fileMap)) {
    throw new Error('Os arquivos do Gist precisam ser um objeto.');
  }

  const files = {};
  for (const [filename, value] of Object.entries(fileMap)) {
    if (value === null || value === undefined) {
      throw new Error(`Não é permitido enviar ${filename} como null ou undefined.`);
    }
    files[filename] = {
      content:
        filename === GAME_SESSIONS_FILENAME
          ? serializeGameSessionsDocument(value)
          : JSON.stringify(value, null, 2),
    };
  }

  const response = await resolveFetch(fetchImpl)(gistUrl(), {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files }),
  });

  assertOk(response, 'atualizar');
  return response.json();
}

async function resolveSaveToken({ token, getToken }) {
  if (typeof getToken === 'function') {
    return getToken();
  }
  return token;
}

function readSavedRevision(patchBody) {
  try {
    return extractGistRevision(patchBody);
  } catch {
    return null;
  }
}

export async function saveGistState({
  players,
  gameSessions,
  expectedRevision,
  token,
  getToken,
  fetchImpl,
} = {}) {
  if (!Array.isArray(players)) {
    throw new Error('players precisa ser um array.');
  }
  const validSessions = validateGameSessionsDocument(gameSessions);

  if (!isUsableRevision(expectedRevision)) {
    throw new Error(GIST_EXPECTED_REVISION_REQUIRED_MESSAGE);
  }

  const { revision: currentRevision } = await fetchGist(fetchImpl);
  if (currentRevision !== expectedRevision) {
    throw new GistRevisionConflictError();
  }

  const resolvedToken = await resolveSaveToken({ token, getToken });
  const patchBody = await patchGistFiles(
    {
      [PLAYERS_FILENAME]: players,
      [GAME_SESSIONS_FILENAME]: validSessions,
    },
    resolvedToken,
    { fetchImpl }
  );

  return {
    revision: readSavedRevision(patchBody),
    response: patchBody,
  };
}

export async function loadPlayersFromGist({ fetchImpl } = {}) {
  const { files } = await fetchGist(fetchImpl);
  const playersContent = await readGistFileContent(files, PLAYERS_FILENAME, { fetchImpl });
  return parsePlayersContent(playersContent);
}

export async function savePlayersToGist(players, token, options) {
  return patchGistFiles({ [PLAYERS_FILENAME]: players }, token, options);
}
