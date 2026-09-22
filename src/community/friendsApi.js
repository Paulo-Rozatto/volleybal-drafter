import { mapFriendList, mapSocialProfile } from './mappers.js';
import { rpcOk } from './client.js';

export async function searchUsersForFriendship(query) {
  const result = await rpcOk('search_users_for_friendship', { p_query: query });
  if (!result.ok) return { ...result, users: [] };
  return { ok: true, users: mapFriendList(result.data) };
}

export async function sendFriendRequest(userId) {
  const result = await rpcOk('send_friend_request', { p_user_id: userId });
  if (!result.ok) return { ...result, request: null };
  return { ok: true, request: result.data };
}

export async function acceptFriendRequest(requestId) {
  return rpcOk('accept_friend_request', { p_request_id: requestId });
}

export async function rejectFriendRequest(requestId) {
  return rpcOk('reject_friend_request', { p_request_id: requestId });
}

export async function cancelFriendRequest(requestId) {
  return rpcOk('cancel_friend_request', { p_request_id: requestId });
}

export async function removeFriendship(userId) {
  return rpcOk('remove_friendship', { p_user_id: userId });
}

export async function listMyFriends() {
  const result = await rpcOk('list_my_friends');
  if (!result.ok) return { ...result, friends: [] };
  return { ok: true, friends: mapFriendList(result.data) };
}

export async function listMyFriendRequests() {
  const result = await rpcOk('list_my_friend_requests');
  if (!result.ok) return { ...result, incoming: [], outgoing: [] };
  return {
    ok: true,
    incoming: mapFriendList(result.data?.incoming),
    outgoing: mapFriendList(result.data?.outgoing),
  };
}

export function friendDisplayName(friend) {
  return friend?.displayName || friend?.playerName || friend?.username || 'Jogador';
}

export { mapSocialProfile };
