export const INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED =
  'INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED';

export const INVALID_COMPETITIONS_CACHE_CONFIRMATION_MESSAGE =
  'O cache local de competições está inválido.\n\nContinuar substituirá os dados locais que não puderam ser lidos.';

function confirmationRequiredResult() {
  return {
    ok: false,
    errors: [
      {
        code: INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED,
        message: INVALID_COMPETITIONS_CACHE_CONFIRMATION_MESSAGE,
      },
    ],
    document: null,
    competition: null,
  };
}

/**
 * Aplica uma operação sobre o documento de competições mais recente, persiste o mesmo
 * resultado e só então atualiza a referência em memória.
 */
export function applyCompetitionsOperation({
  getDocument,
  setDocument,
  persistDocument,
  markPending,
  operation,
  cacheInvalid = false,
  discardConfirmed = false,
}) {
  if (cacheInvalid && !discardConfirmed) {
    return confirmationRequiredResult();
  }

  const current = getDocument();
  const result = operation(current);
  if (!result?.ok) {
    return result;
  }

  if (result.unchanged) {
    return {
      ...result,
      persistOk: true,
      persistError: null,
      cacheCleared: false,
    };
  }

  const persistResult = persistDocument(result.document);
  if (!persistResult?.ok) {
    if (!cacheInvalid) {
      setDocument(result.document);
      markPending();
    }
    return {
      ...result,
      persistOk: false,
      persistError: persistResult?.error || 'Não foi possível salvar o cache local de competições.',
      cacheCleared: false,
    };
  }

  setDocument(result.document);
  markPending();
  return {
    ...result,
    persistOk: true,
    persistError: null,
    cacheCleared: Boolean(cacheInvalid && discardConfirmed),
  };
}
