import { useEffect, useRef } from 'react';
import { shouldAcceptCloudSession } from '../supabase/cloudSessionDocument.js';
import { getSupabaseClient } from '../supabase/client.js';
import { loadCloudCompetition } from '../supabase/competitionApi.js';
import { applyCompetitionMatchRealtimeChange } from '../supabase/competitionMappers.js';

const STRUCTURAL_TABLES = [
  { table: 'competitions', filterColumn: 'id' },
  { table: 'competition_members', filterColumn: 'competition_id' },
  { table: 'competition_players', filterColumn: 'competition_id' },
  { table: 'competition_teams', filterColumn: 'competition_id' },
  { table: 'competition_team_members', filterColumn: 'competition_id' },
  { table: 'competition_stages', filterColumn: 'competition_id' },
  { table: 'competition_rounds', filterColumn: 'competition_id' },
  { table: 'competition_round_byes', filterColumn: 'competition_id' },
  { table: 'competition_match_players', filterColumn: 'competition_id' },
  { table: 'competition_match_events', filterColumn: 'competition_id' },
];

function changeEvent(payload) {
  return payload?.eventType ?? payload?.event ?? payload?.type;
}

export function isScoreOnlyCompetitionMatchUpdate(payload) {
  if (changeEvent(payload) !== 'UPDATE') return false;
  const next = payload?.new ?? {};
  if (!next.id) return false;
  const oldRow = payload?.old ?? {};
  const structuralKeys = ['round_id', 'stage_id', 'team_a_id', 'team_b_id', 'competition_id'];
  const hasOldStructure = structuralKeys.some((key) => oldRow[key] != null);
  if (!hasOldStructure) return true;
  return structuralKeys.every((key) => oldRow[key] === next[key]);
}

export default function useCloudCompetitionRealtime(loaded, onChange, userId) {
  const competitionId = loaded?.competition?.id ?? null;
  const onChangeRef = useRef(onChange);
  const loadedRef = useRef(loaded);
  const userIdRef = useRef(userId);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !competitionId) return undefined;

    let timer = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const current = loadedRef.current;
        const uid = userIdRef.current;
        if (!current?.competition?.id || !uid) return;
        const next = await loadCloudCompetition(current.competition.id, uid);
        if (!next.ok) return;
        if (shouldAcceptCloudSession(
          { structureVersion: current.structureVersion },
          { structureVersion: next.loaded.structureVersion }
        )) {
          onChangeRef.current?.(next.loaded);
        }
      }, 300);
    };

    let channel = supabase.channel(`competition:${competitionId}:live`);
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'competition_matches',
        filter: `competition_id=eq.${competitionId}`,
      },
      (payload) => {
        if (isScoreOnlyCompetitionMatchUpdate(payload)) {
          const current = loadedRef.current;
          if (!current) return;
          const next = applyCompetitionMatchRealtimeChange(current, payload.new);
          if (next !== current) onChangeRef.current?.(next);
          return;
        }
        scheduleRefetch();
      }
    );

    for (const spec of STRUCTURAL_TABLES) {
      const filter =
        spec.filterColumn === 'id'
          ? `id=eq.${competitionId}`
          : `${spec.filterColumn}=eq.${competitionId}`;
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: spec.table, filter },
        () => scheduleRefetch()
      );
    }

    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [competitionId]);
}
