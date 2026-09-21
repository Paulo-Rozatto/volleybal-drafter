const PLACEHOLDER_RE = /YOUR_PROJECT|SEU-PROJETO|YOUR_ANON_KEY|SUA_ANON_KEY/i;

export function looksLikeSupabasePlaceholder(url, anonKey) {
  return PLACEHOLDER_RE.test(String(url ?? '')) || PLACEHOLDER_RE.test(String(anonKey ?? ''));
}

export function isSupabaseConfigured() {
  const url = String(import.meta.env?.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = String(import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return Boolean(url && anonKey) && !looksLikeSupabasePlaceholder(url, anonKey);
}

export function getSupabaseConfig() {
  return {
    url: import.meta.env?.VITE_SUPABASE_URL ?? '',
    anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '',
  };
}
