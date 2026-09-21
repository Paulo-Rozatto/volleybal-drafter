const LOAD_FAILED_MESSAGE = 'Não foi possível abrir o encontro.';

export function createdCloudSessionId(created) {
  if (!created?.ok) return null;
  const id = created.session?.id;
  return typeof id === 'string' && id ? id : null;
}

export function shouldApplySessionLoad(requestId, openSessionId) {
  return Boolean(requestId) && requestId === openSessionId;
}

export async function fetchOpenCloudSession(loadCloudSession, sessionId, userId) {
  try {
    const result = await loadCloudSession(sessionId, userId);
    if (result?.ok && result.session) {
      return { ok: true, session: result.session, error: null };
    }
    return {
      ok: false,
      session: null,
      error: result?.error?.message || LOAD_FAILED_MESSAGE,
    };
  } catch (error) {
    return {
      ok: false,
      session: null,
      error: error?.message || LOAD_FAILED_MESSAGE,
    };
  }
}
