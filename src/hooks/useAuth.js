import { useEffect, useState } from 'react';
import { subscribeAuth } from '../supabase/auth.js';
import { isSupabaseConfigured } from '../supabase/config.js';

export default function useAuth() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!configured);

  useEffect(() => {
    if (!configured) return undefined;
    return subscribeAuth((next) => {
      setSession(next);
      setReady(true);
    });
  }, [configured]);

  return {
    configured,
    ready,
    session,
    user: session?.user ?? null,
  };
}
