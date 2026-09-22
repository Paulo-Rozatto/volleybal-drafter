export const GIST_REVISION_CONFLICT = 'GIST_REVISION_CONFLICT';

export const GIST_REVISION_CONFLICT_MESSAGE =
  'O Gist foi alterado em outro dispositivo. Recarregue os dados antes de salvar.';

export const GIST_REVISION_MISSING_MESSAGE = 'A resposta do Gist não inclui uma revisão válida.';

export const GIST_EXPECTED_REVISION_REQUIRED_MESSAGE =
  'A revisão esperada do Gist é obrigatória para salvar.';

function normalizeRevisionValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/**
 * Extrai uma revisão estável da resposta JSON do Gist.
 * Prioriza `history[0].version` e recai para `updated_at`.
 *
 * @param {unknown} gistData
 * @returns {string}
 */
export function extractGistRevision(gistData) {
  const version = normalizeRevisionValue(gistData?.history?.[0]?.version);
  if (version) return `version:${version}`;

  const updatedAt = normalizeRevisionValue(gistData?.updated_at);
  if (updatedAt) return `updated_at:${updatedAt}`;

  throw new Error(GIST_REVISION_MISSING_MESSAGE);
}

export class GistRevisionConflictError extends Error {
  constructor(message = GIST_REVISION_CONFLICT_MESSAGE) {
    super(message);
    this.name = 'GistRevisionConflictError';
    this.code = GIST_REVISION_CONFLICT;
  }
}

export function isGistRevisionConflict(error) {
  return error?.code === GIST_REVISION_CONFLICT;
}
