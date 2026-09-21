const LOAD_FAILED_MESSAGE = 'Não foi possível abrir o grupo.';

export function createdCloudGroupId(created) {
  if (!created?.ok) return null;
  const id = created.groupId ?? created.group?.id;
  return typeof id === 'string' && id ? id : null;
}

export function shouldApplyGroupLoad(requestId, openGroupId) {
  return Boolean(requestId) && requestId === openGroupId;
}

export function shouldApplyGroupListLoad(requestUserId, currentUserId) {
  return Boolean(requestUserId) && requestUserId === currentUserId;
}

export async function fetchOpenCloudGroup(loadGroup, groupId, userId) {
  try {
    const result = await loadGroup(groupId, userId);
    if (result?.ok && result.group) {
      return { ok: true, group: result.group, error: null };
    }
    return {
      ok: false,
      group: null,
      error: result?.error?.message || LOAD_FAILED_MESSAGE,
    };
  } catch (error) {
    return {
      ok: false,
      group: null,
      error: error?.message || LOAD_FAILED_MESSAGE,
    };
  }
}
