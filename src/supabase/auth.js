import { getSupabaseClient } from './client.js';
import { buildAuthRedirectTo, normalizeJoinCode } from './joinCode.js';

export function subscribeAuth(onSession) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    onSession?.(null);
    return () => {};
  }

  supabase.auth.getSession().then(({ data }) => {
    onSession?.(data.session ?? null);
  });

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onSession?.(session ?? null);
  });

  return () => {
    data?.subscription?.unsubscribe?.();
  };
}

export async function signInWithMagicLink(email, { joinCode, origin, base } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: { code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' } };
  }

  const emailRedirectTo = buildAuthRedirectTo({
    origin: origin ?? globalThis.location?.origin,
    base: base ?? import.meta.env?.BASE_URL ?? '/',
    joinCode,
  });

  const { error } = await supabase.auth.signInWithOtp({
    email: String(email ?? '').trim(),
    options: { emailRedirectTo, shouldCreateUser: true },
  });

  if (error) {
    return { ok: false, error: { code: 'AUTH_OTP_FAILED', message: error.message } };
  }

  return { ok: true, emailRedirectTo, joinCode: joinCode ? normalizeJoinCode(joinCode) : null };
}

export async function signOut() {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: true };
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: { code: 'AUTH_SIGNOUT_FAILED', message: error.message } };
  return { ok: true };
}

export async function getCurrentUser() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
