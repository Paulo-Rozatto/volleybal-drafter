import {
  COMPETITIONS_FILENAME,
  GAME_SESSIONS_FILENAME,
  PLAYERS_FILENAME,
} from '../../persistence/constants.js';
import {
  createEmptyGameSessionsDocument,
  interpretGameSessionsJson,
} from '../../persistence/gameSessionsDocument.js';
import {
  createEmptyCompetitionDocument,
  interpretCompetitionsJson,
} from '../../persistence/competitionsDocument.js';
import { readGistFileContent } from './gistFileContent.js';
import { extractGistRevision } from './gistRevision.js';

export const GIST_ID = '58f047706f0f4c48bc83b18aab5e5949';
export { COMPETITIONS_FILENAME, GAME_SESSIONS_FILENAME, PLAYERS_FILENAME };

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

function parseCompetitionsContent(content) {
  if (isBlankContent(content)) {
    return {
      document: createEmptyCompetitionDocument(),
      sourceVersion: null,
      migrated: false,
    };
  }

  try {
    JSON.parse(content);
  } catch {
    throw new Error('JSON inválido em competitions.json.');
  }

  try {
    return interpretCompetitionsJson(content);
  } catch (error) {
    throw new Error(`Arquivo competitions.json inválido: ${error.message}`);
  }
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
  const competitionsContent = await readGistFileContent(files, COMPETITIONS_FILENAME, {
    fetchImpl,
  });
  const sessions = parseGameSessionsContent(sessionsContent);
  const competitions = parseCompetitionsContent(competitionsContent);

  return {
    players: parsePlayersContent(playersContent),
    gameSessions: sessions.document,
    competitions: competitions.document,
    migrated: Boolean(sessions.migrated || competitions.migrated),
    sourceVersion: sessions.sourceVersion,
    competitionsSourceVersion: competitions.sourceVersion,
    revision,
  };
}

export async function loadPlayersFromGist({ fetchImpl } = {}) {
  const { files } = await fetchGist(fetchImpl);
  const playersContent = await readGistFileContent(files, PLAYERS_FILENAME, { fetchImpl });
  return parsePlayersContent(playersContent);
}
