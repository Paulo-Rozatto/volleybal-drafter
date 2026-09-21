import { useEffect, useRef } from 'react';
import { shouldAcceptCloudSession } from '../supabase/cloudSessionDocument.js';
import { getSupabaseClient } from '../supabase/client.js';
import { applyMatchRealtimeChange } from '../supabase/mappers.js';
import { loadCloudSession } from '../supabase/sessionApi.js';

const STRUCTURAL_TABLES = [
  { table: 'sessions', filterColumn: 'id' },
  { table: 'session_members', filterColumn: 'session_id' },
  { table: 'session_players', filterColumn: 'session_id' },
  { table: 'teams', filterColumn: 'session_id' },
  { table: 'team_members', filterColumn: 'session_id' },
  { table: 'rounds', filterColumn: 'session_id' },
  { table: 'match_players', filterColumn: 'session_id' },
  { table: 'match_events', filterColumn: 'session_id' },
];

function changeEvent(payload) {
  return payload?.eventType ?? payload?.event ?? payload?.type;
}

export function isScoreOnlyMatchUpdate(payload) {
  if (changeEvent(payload) !== 'UPDATE') return false;
  const next = payload?.new ?? {};
  if (!next.id) return false;
  const oldRow = payload?.old ?? {};
  const structuralKeys = ['round_id', 'team_a_id', 'team_b_id', 'session_id'];
  const hasOldStructure = structuralKeys.some((key) => oldRow[key] != null);
  if (!hasOldStructure) return true;
  return structuralKeys.every((key) => oldRow[key] === next[key]);
}

export default function useCloudSessionRealtime(session, onSessionChange, userId) {
  const sessionId = session?.id ?? null;
  const onChangeRef = useRef(onSessionChange);
  const sessionRef = useRef(session);
  const userIdRef = useRef(userId);

  useEffect(() => {
    onChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !sessionId) return undefined;

    let timer = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const current = sessionRef.current;
        const uid = userIdRef.current;
        if (!current?.id || !uid) return;
        const loaded = await loadCloudSession(current.id, uid);
        if (!loaded.ok) return;
        if (shouldAcceptCloudSession(sessionRef.current, loaded.session)) {
          onChangeRef.current?.(loaded.session);
        }
      }, 300);
    };

    let channel = supabase.channel(`session:${sessionId}:live`);
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'matches',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        if (isScoreOnlyMatchUpdate(payload)) {
          const current = sessionRef.current;
          if (!current) return;
          const next = applyMatchRealtimeChange(current, payload.new);
          if (next !== current) onChangeRef.current?.(next);
          return;
        }
        scheduleRefetch();
      }
    );

    for (const { table, filterColumn } of STRUCTURAL_TABLES) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `${filterColumn}=eq.${sessionId}`,
        },
        scheduleRefetch
      );
    }

    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [sessionId]);
}
