import { getSupabaseClient } from '../supabase/client.js';
import { messageForCloudError, rpcErrorCode } from '../supabase/errors.js';

export function fail(error) {
  const code = rpcErrorCode(error) ?? error?.code ?? 'CLOUD_ERROR';
  return {
    ok: false,
    error: {
      code,
      message: messageForCloudError({ ...error, message: error?.message, code }),
    },
  };
}

export function requireClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      supabase: null,
      error: fail({ code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' }),
    };
  }
  return { supabase, error: null };
}

export async function rpcOk(name, params = {}) {
  const { supabase, error } = requireClient();
  if (error) return error;
  const { data, error: rpcError } = await supabase.rpc(name, params);
  if (rpcError) return fail(rpcError);
  return { ok: true, data };
}
