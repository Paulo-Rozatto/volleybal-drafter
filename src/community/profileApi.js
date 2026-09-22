import { fail, requireClient, rpcOk } from './client.js';
import { mapSocialProfile } from './mappers.js';
import { normalizeUsernameInput } from './usernames.js';

export async function getMySocialProfile() {
  const result = await rpcOk('get_my_social_profile');
  if (!result.ok) return { ...result, profile: null };
  return { ok: true, profile: mapSocialProfile(result.data) };
}

export async function updateMySocialProfile({ displayName, username, avatarPath } = {}) {
  const params = {};
  if (displayName != null) params.p_display_name = displayName;
  if (username != null) params.p_username = normalizeUsernameInput(username);
  if (avatarPath !== undefined) params.p_avatar_path = avatarPath;
  const result = await rpcOk('update_my_social_profile', params);
  if (!result.ok) return { ...result, profile: null };
  return { ok: true, profile: mapSocialProfile(result.data) };
}

export async function getSocialPlayerProfile(playerId) {
  const result = await rpcOk('get_social_player_profile', { p_player_id: playerId });
  if (!result.ok) return { ...result, payload: null };
  return {
    ok: true,
    payload: {
      profile: mapSocialProfile(result.data?.profile),
      player: result.data?.player ?? null,
      matches: result.data?.matches ?? [],
    },
  };
}

export async function loadSocialPlayerPerformance(playerId) {
  return getSocialPlayerProfile(playerId);
}

const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadMyAvatar(file) {
  const { supabase, error } = requireClient();
  if (error) return { ...error, path: null };
  if (!file) return { ...fail({ code: 'AVATAR_REQUIRED', message: 'Escolha uma foto.' }), path: null };
  if (!AVATAR_TYPES.has(file.type)) {
    return { ...fail({ code: 'AVATAR_TYPE', message: 'Use JPEG, PNG ou WebP.' }), path: null };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ...fail({ code: 'AVATAR_TOO_LARGE', message: 'A foto deve ter no máximo 512 KB.' }), path: null };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) return { ...fail(userError ?? { code: 'AUTH_REQUIRED' }), path: null };

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const folder = `${user.id}`;
  const path = `${folder}/avatar.${ext}`;

  const existing = await supabase.storage.from('avatars').list(folder);
  if (!existing.error) {
    const stale = (existing.data ?? []).filter((item) => item.name && item.name !== `avatar.${ext}`);
    if (stale.length > 0) {
      await supabase.storage.from('avatars').remove(stale.map((item) => `${folder}/${item.name}`));
    }
  }

  const uploaded = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '3600',
  });
  if (uploaded.error) return { ...fail(uploaded.error), path: null };

  const updated = await updateMySocialProfile({ avatarPath: path });
  if (!updated.ok) return { ...updated, path: null };
  return { ok: true, path, profile: updated.profile };
}

const signedUrlCache = new Map();

export async function resolveAvatarUrl(avatarPath) {
  if (!avatarPath) return null;
  const cached = signedUrlCache.get(avatarPath);
  if (cached && cached.expiresAt > Date.now() + 15_000) return cached.url;

  const { supabase, error } = requireClient();
  if (error) return null;
  const signed = await supabase.storage.from('avatars').createSignedUrl(avatarPath, 3600);
  if (signed.error || !signed.data?.signedUrl) return null;
  signedUrlCache.set(avatarPath, {
    url: signed.data.signedUrl,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });
  return signed.data.signedUrl;
}

export function clearAvatarUrlCache() {
  signedUrlCache.clear();
}
