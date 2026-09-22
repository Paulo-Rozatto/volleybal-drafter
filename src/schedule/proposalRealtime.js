import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '../supabase/client.js';
import { fetchGroupGameProposal } from './proposalApi.js';
import { mergeProposalList } from './mappers.js';

export const PROPOSAL_REALTIME_STRATEGY = 'rpc-then-reload-by-id';

export function applyProposalChange(list, payload) {
  const event = payload?.eventType ?? payload?.event ?? payload?.type;
  const row = payload?.new ?? payload?.old ?? null;
  if (!row?.id) return list;
  if (event === 'DELETE') {
    return (Array.isArray(list) ? list : []).filter((item) => item.id !== row.id);
  }
  return mergeProposalList(list, row);
}

export default function useGroupProposalRealtime(groupId, onChange) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !groupId) return undefined;
    const channel = supabase
      .channel(`group-proposals:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_game_proposals',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          onChangeRef.current?.((current) => applyProposalChange(current, payload));
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_game_proposal_responses',
        },
        (payload) => {
          const proposalId = payload?.new?.proposal_id ?? payload?.old?.proposal_id;
          if (!proposalId) return;
          fetchGroupGameProposal(proposalId).then((result) => {
            if (result.ok && result.payload?.proposal) {
              onChangeRef.current?.((current) => mergeProposalList(current, result.payload.proposal));
            }
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
