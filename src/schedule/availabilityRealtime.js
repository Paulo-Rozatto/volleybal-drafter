import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '../supabase/client.js';
import { mergeAvailabilitySlots } from './mappers.js';

export const AVAILABILITY_REALTIME_STRATEGY = 'rpc-then-dedupe-by-user-slot';

export function applyAvailabilityChange(slots, payload) {
  const event = payload?.eventType ?? payload?.event ?? payload?.type;
  const row = event === 'DELETE' ? payload?.old ?? payload?.new : payload?.new ?? payload?.old;
  return mergeAvailabilitySlots(slots, row, event);
}

export default function useGroupAvailabilityRealtime(groupId, onChange) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !groupId) return undefined;
    const channel = supabase
      .channel(`group-availability:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_availability_slots',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          onChangeRef.current?.((current) => applyAvailabilityChange(current, payload));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
