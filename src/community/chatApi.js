import { fail, requireClient, rpcOk } from './client.js';
import { mapGroupMessage, mergeGroupMessage, sortGroupMessages } from './mappers.js';

export async function listGroupMessages(groupId, { profilesByUserId = {}, limit = 100 } = {}) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, messages: [] };
  const { data, error: queryError } = await supabase
    .from('group_messages')
    .select('id, group_id, sender_user_id, body, created_at, edited_at, deleted_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (queryError) return { ...fail(queryError), messages: [] };
  return {
    ok: true,
    messages: sortGroupMessages((data ?? []).map((row) => mapGroupMessage(row, profilesByUserId))),
  };
}

export async function sendGroupMessage(groupId, body) {
  const result = await rpcOk('send_group_message', { p_group_id: groupId, p_body: body });
  if (!result.ok) return { ...result, message: null };
  return { ok: true, message: mapGroupMessage(result.data) };
}

export async function editGroupMessage(messageId, body) {
  const result = await rpcOk('edit_group_message', { p_message_id: messageId, p_body: body });
  if (!result.ok) return { ...result, message: null };
  return { ok: true, message: mapGroupMessage(result.data) };
}

export async function deleteGroupMessage(messageId) {
  const result = await rpcOk('delete_group_message', { p_message_id: messageId });
  if (!result.ok) return { ...result, message: null };
  return { ok: true, message: mapGroupMessage(result.data) };
}

export { mapGroupMessage, mergeGroupMessage, sortGroupMessages };
