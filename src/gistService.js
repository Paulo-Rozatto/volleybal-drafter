import { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME } from './persistence/constants.js';
import {
  createEmptyGameSessionsDocument,
  parseGameSessionsJson,
  validateGameSessionsDocument,
} from './persistence/gameSessionsDocument.js';

export const GIST_ID = '58f047706f0f4c48bc83b18aab5e5949';
export const DEFAULT_FILENAME = PLAYERS_FILENAME;
export const ENCRYPTED_GITHUB_TOKEN = 'Dh4mcqVeMAbw4SEOao+YGy+FZy6eEzQDxZ3fu30e3XuRWA7d/GATh9n0dQASmvfH5DLwOCJT+uak41sEDSPlolIN1NyCsqBc0olt7GkR7mIUStS1dFTA+cjZmaBlAtmPDOqFrxsA4LsnrxES85OWKKxxjUdoWWFDuQ==';

export { GAME_SESSIONS_FILENAME, PLAYERS_FILENAME };

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
    return createEmptyGameSessionsDocument();
  }

  try {
    JSON.parse(content);
  } catch {
    throw new Error('JSON inválido em game-sessions.json.');
  }

  try {
    return parseGameSessionsJson(content);
  } catch (error) {
    throw new Error(`Arquivo game-sessions.json inválido: ${error.message}`);
  }
}

async function fetchGistFiles(fetchImpl) {
  const response = await resolveFetch(fetchImpl)(gistUrl(), {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });

  assertOk(response, 'carregar');

  const data = await response.json();
  return data.files ?? {};
}

export async function loadGistState({ fetchImpl } = {}) {
  const files = await fetchGistFiles(fetchImpl);

  return {
    players: parsePlayersContent(files[PLAYERS_FILENAME]?.content),
    gameSessions: parseGameSessionsContent(files[GAME_SESSIONS_FILENAME]?.content),
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
      content: JSON.stringify(value, null, 2),
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

export async function saveGistState({ players, gameSessions, token, fetchImpl } = {}) {
  if (!Array.isArray(players)) {
    throw new Error('players precisa ser um array.');
  }
  validateGameSessionsDocument(gameSessions);

  return patchGistFiles(
    {
      [PLAYERS_FILENAME]: players,
      [GAME_SESSIONS_FILENAME]: gameSessions,
    },
    token,
    { fetchImpl }
  );
}

export async function loadPlayersFromGist({ fetchImpl } = {}) {
  const files = await fetchGistFiles(fetchImpl);
  return parsePlayersContent(files[PLAYERS_FILENAME]?.content);
}

export async function savePlayersToGist(players, token, options) {
  return patchGistFiles({ [PLAYERS_FILENAME]: players }, token, options);
}
