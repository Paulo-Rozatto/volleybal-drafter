import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '../supabase/client.js';
import { mapGroupMessage, mergeGroupMessage } from './mappers.js';

/**
 * Realtime do chat: opção B com id real.
 * A UI envia via RPC, renderiza a linha devolvida pelo servidor e o evento
 * postgres_changes é mesclado por `id` (sem duplicar, sem id temporário).
 * Offline: não enfileira; o envio falha visivelmente.
 */
export const GROUP_CHAT_REALTIME_STRATEGY = 'rpc-then-dedupe-by-id';

export function applyGroupChatChange(messages, payload, profilesByUserId = {}) {
  const event = payload?.eventType ?? payload?.event ?? payload?.type;
  const row = payload?.new ?? payload?.old ?? null;
  if (!row?.id) return messages;
  if (event === 'DELETE') {
    return (Array.isArray(messages) ? messages : []).filter((item) => item.id !== row.id);
  }
  return mergeGroupMessage(messages, mapGroupMessage(row, profilesByUserId));
}

export default function useGroupChatRealtime(groupId, onChange, profilesByUserId) {
  const onChangeRef = useRef(onChange);
  const profilesRef = useRef(profilesByUserId);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    profilesRef.current = profilesByUserId;
  }, [profilesByUserId]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !groupId) return undefined;

    const channel = supabase
      .channel(`group-chat:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          onChangeRef.current?.((current) =>
            applyGroupChatChange(current, payload, profilesRef.current)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
