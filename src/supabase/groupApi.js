import { getSupabaseClient } from './client.js';
import { messageForCloudError, rpcErrorCode } from './errors.js';
import { attachGroupMembers, mapGroup } from './groupMappers.js';
import { normalizeJoinCode } from './joinCode.js';

function fail(error) {
  const code = rpcErrorCode(error) ?? error?.code ?? 'CLOUD_ERROR';
  return {
    ok: false,
    error: {
      code,
      message: messageForCloudError({ ...error, message: error?.message, code }),
    },
  };
}

function requireClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      supabase: null,
      error: fail({ code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' }),
    };
  }
  return { supabase, error: null };
}

async function rpcOk(name, params = {}) {
  const { supabase, error } = requireClient();
  if (error) return error;
  const { data, error: rpcError } = await supabase.rpc(name, params);
  if (rpcError) return fail(rpcError);
  return { ok: true, data };
}

export async function listMyGroups(myUserId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, groups: [] };

  try {
    const [groupsResult, membersResult] = await Promise.all([
      supabase
        .from('groups')
        .select('id, name, description, join_code, created_by, created_at, updated_at')
        .order('name'),
      supabase.from('group_members').select('group_id, user_id, role, joined_at'),
    ]);

    const firstError = groupsResult.error || membersResult.error;
    if (firstError) return { ...fail(firstError), groups: [] };

    return {
      ok: true,
      groups: attachGroupMembers(groupsResult.data ?? [], membersResult.data ?? [], myUserId),
    };
  } catch (caught) {
    return { ...fail(caught), groups: [] };
  }
}

export async function loadGroup(groupId, myUserId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, group: null };

  try {
    const [groupResult, membersResult] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
      supabase
        .from('group_members')
        .select('group_id, user_id, role, joined_at, profiles(id, display_name)')
        .eq('group_id', groupId),
    ]);

    const firstError = groupResult.error || membersResult.error;
    if (firstError) return { ...fail(firstError), group: null };
    if (!groupResult.data) {
      return { ...fail({ code: 'GROUP_NOT_FOUND', message: 'Grupo não encontrado.' }), group: null };
    }

    return {
      ok: true,
      group: mapGroup({
        group: groupResult.data,
        members: membersResult.data ?? [],
        myUserId,
      }),
    };
  } catch (caught) {
    return { ...fail(caught), group: null };
  }
}

export async function listGroupSessions(groupId) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, sessions: [] };

  const { data, error: queryError } = await supabase
    .from('sessions')
    .select(
      'id, name, date, status, join_code, team_size, team_count, structure_version, group_id, created_at, updated_at'
    )
    .eq('group_id', groupId)
    .order('date', { ascending: false });

  if (queryError) return { ...fail(queryError), sessions: [] };
  return { ok: true, sessions: data ?? [] };
}

export async function createGroup({ name, description = null }) {
  const result = await rpcOk('create_group', {
    p_name: String(name ?? '').trim(),
    p_description: description?.trim() ? description.trim() : null,
  });
  if (!result.ok) return { ...result, groupId: null, group: null };
  return { ok: true, groupId: result.data?.id ?? null, group: result.data };
}

export async function joinGroupByCode(joinCode) {
  const result = await rpcOk('join_group_by_code', {
    p_join_code: normalizeJoinCode(joinCode),
  });
  if (!result.ok) return { ...result, groupId: null };
  return { ok: true, groupId: result.data };
}

export async function rotateGroupJoinCode(groupId) {
  const result = await rpcOk('rotate_group_join_code', { p_group_id: groupId });
  if (!result.ok) return { ...result, joinCode: null };
  return { ok: true, joinCode: result.data };
}

export async function updateGroup(groupId, { name, description = null }) {
  const result = await rpcOk('update_group', {
    p_group_id: groupId,
    p_name: String(name ?? '').trim(),
    p_description: description?.trim() ? description.trim() : null,
  });
  if (!result.ok) return { ...result, group: null };
  return { ok: true, group: result.data };
}

export async function setGroupMemberRole(groupId, userId, role) {
  return rpcOk('set_group_member_role', {
    p_group_id: groupId,
    p_user_id: userId,
    p_role: role,
  });
}

export async function removeGroupMember(groupId, userId) {
  return rpcOk('remove_group_member', {
    p_group_id: groupId,
    p_user_id: userId,
  });
}

export async function leaveGroup(groupId) {
  return rpcOk('leave_group', { p_group_id: groupId });
}
