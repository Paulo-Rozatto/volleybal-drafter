import { getSupabaseClient } from './client.js';
import { messageForCloudError, rpcErrorCode } from './errors.js';

function fail(error) {
  const code = rpcErrorCode(error) ?? error?.code ?? 'CLOUD_ERROR';
  return {
    ok: false,
    error: {
      code,
      message: messageForCloudError({ ...error, message: error?.message, code }),
    },
  };
}

export async function getGroupPerformanceMatches(groupId) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      ...fail({ code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' }),
      payload: null,
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_group_performance_matches', {
      p_group_id: groupId,
    });
    if (error) return { ...fail(error), payload: null };
    return { ok: true, payload: data };
  } catch (caught) {
    return { ...fail(caught), payload: null };
  }
}
