import { rpcOk } from '../community/client.js';
import { mapAvailabilityPayload } from './mappers.js';

export async function fetchGroupAvailability(groupId, start, end) {
  const result = await rpcOk('get_group_availability', {
    p_group_id: groupId,
    p_start: start,
    p_end: end,
  });
  if (!result.ok) return { ...result, payload: null };
  return { ok: true, payload: mapAvailabilityPayload(result.data) };
}

export async function saveMyGroupAvailability(groupId, windowStart, windowEnd, slotStarts) {
  const result = await rpcOk('set_my_group_availability', {
    p_group_id: groupId,
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_slot_starts: slotStarts,
  });
  if (!result.ok) return { ...result, saved: 0 };
  return { ok: true, saved: result.data?.saved ?? 0 };
}
