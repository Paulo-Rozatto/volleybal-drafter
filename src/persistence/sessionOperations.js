export const INVALID_CACHE_CONFIRMATION_REQUIRED = 'INVALID_CACHE_CONFIRMATION_REQUIRED';

export const INVALID_CACHE_CONFIRMATION_MESSAGE =
  'O cache local de encontros está inválido.\n\nContinuar substituirá os dados locais que não puderam ser lidos.';

function confirmationRequiredResult() {
  return {
    ok: false,
    errors: [
      {
        code: INVALID_CACHE_CONFIRMATION_REQUIRED,
        message: INVALID_CACHE_CONFIRMATION_MESSAGE,
      },
    ],
    document: null,
    session: null,
  };
}

/**
 * Aplica uma operação sobre o documento de encontros mais recente, persiste o mesmo
 * resultado e só então atualiza a referência em memória. Sem efeitos colaterais no
 * callback de setState.
 *
 * @param {{
 *   getDocument: () => object,
 *   setDocument: (document: object) => void,
 *   persistDocument: (document: object) => { ok: boolean, error?: string | null },
 *   markPending: () => void,
 *   operation: (document: object) => { ok: boolean, errors?: Array<object>, document?: object, session?: object },
 *   cacheInvalid?: boolean,
 *   discardConfirmed?: boolean,
 * }} options
 */
export function applyGameSessionsOperation({
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
      persistError: persistResult?.error || 'Não foi possível salvar o cache local de encontros.',
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
