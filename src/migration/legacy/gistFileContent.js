export const GIST_RAW_HOST = 'gist.githubusercontent.com';

export const GIST_RAW_URL_REQUIRED_MESSAGE =
  'A URL raw do arquivo do Gist está ausente ou é inválida.';
export const GIST_RAW_URL_HTTPS_MESSAGE = 'A URL raw do arquivo do Gist precisa usar HTTPS.';
export const GIST_RAW_URL_HOST_MESSAGE =
  'A URL raw do arquivo do Gist precisa ser de gist.githubusercontent.com.';

function resolveFetch(fetchImpl) {
  return fetchImpl ?? fetch;
}

function assertRawOk(response) {
  if (response.ok) return;
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  throw new Error(
    `Falha ao carregar o arquivo raw do Gist (HTTP ${response.status}${statusText}).`
  );
}

export function assertGistRawUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new Error(GIST_RAW_URL_REQUIRED_MESSAGE);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(GIST_RAW_URL_REQUIRED_MESSAGE);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(GIST_RAW_URL_HTTPS_MESSAGE);
  }

  if (parsed.hostname !== GIST_RAW_HOST) {
    throw new Error(GIST_RAW_URL_HOST_MESSAGE);
  }

  return parsed.href;
}

function isAbsentFile(files, filename) {
  if (files == null || typeof files !== 'object' || Array.isArray(files)) return true;
  if (!Object.prototype.hasOwnProperty.call(files, filename)) return true;
  return files[filename] == null;
}

export async function readGistFileContent(files, filename, { fetchImpl } = {}) {
  if (isAbsentFile(files, filename)) return undefined;

  const file = files[filename];
  if (file?.truncated !== true) {
    return file?.content;
  }

  const rawUrl = assertGistRawUrl(file?.raw_url);
  const response = await resolveFetch(fetchImpl)(rawUrl);
  assertRawOk(response);
  return response.text();
}
