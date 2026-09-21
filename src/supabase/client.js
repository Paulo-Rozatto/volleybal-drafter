import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, isSupabaseConfigured } from './config.js';

let client = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;

  const { url, anonKey } = getSupabaseConfig();
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      autoRefreshToken: true,
    },
  });
  return client;
}

export function resetSupabaseClientForTests() {
  client = null;
}
