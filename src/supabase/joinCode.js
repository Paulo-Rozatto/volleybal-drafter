const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export const PENDING_JOIN_CODE_KEY = 'volleyPendingJoinCode';
export const PENDING_GROUP_JOIN_CODE_KEY = 'volleyPendingGroupJoinCode';
export const PENDING_COMPETITION_JOIN_CODE_KEY = 'volleyPendingCompetitionJoinCode';

export function normalizeJoinCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function isCanonicalJoinCode(value) {
  return JOIN_CODE_PATTERN.test(normalizeJoinCode(value));
}

export function parseJoinHash(hash) {
  const match = String(hash ?? '').match(/^#\/join\/([A-Za-z0-9]+)/i);
  return match ? normalizeJoinCode(match[1]) : null;
}

export function parseJoinSearch(search) {
  const query = String(search ?? '');
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const raw = params.get('join');
  return raw ? normalizeJoinCode(raw) : null;
}

export function rememberPendingJoinCode(code, storage = globalThis.sessionStorage) {
  const normalized = normalizeJoinCode(code);
  if (!normalized) {
    storage?.removeItem?.(PENDING_JOIN_CODE_KEY);
    return null;
  }
  storage?.setItem?.(PENDING_JOIN_CODE_KEY, normalized);
  return normalized;
}

export function readPendingJoinCode(storage = globalThis.sessionStorage) {
  const raw = storage?.getItem?.(PENDING_JOIN_CODE_KEY);
  return raw ? normalizeJoinCode(raw) : null;
}

export function clearPendingJoinCode(storage = globalThis.sessionStorage) {
  storage?.removeItem?.(PENDING_JOIN_CODE_KEY);
}

export function resolveIncomingJoinCode({
  hash = '',
  search = '',
  storage = globalThis.sessionStorage,
} = {}) {
  return parseJoinSearch(search) || parseJoinHash(hash) || readPendingJoinCode(storage);
}

export function parseGroupJoinHash(hash) {
  const match = String(hash ?? '').match(/^#\/group\/join\/([A-Za-z0-9]+)/i);
  return match ? normalizeJoinCode(match[1]) : null;
}

export function parseGroupJoinSearch(search) {
  const query = String(search ?? '');
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const raw = params.get('groupJoin');
  return raw ? normalizeJoinCode(raw) : null;
}

export function rememberPendingGroupJoinCode(code, storage = globalThis.sessionStorage) {
  const normalized = normalizeJoinCode(code);
  if (!normalized) {
    storage?.removeItem?.(PENDING_GROUP_JOIN_CODE_KEY);
    return null;
  }
  storage?.setItem?.(PENDING_GROUP_JOIN_CODE_KEY, normalized);
  return normalized;
}

export function readPendingGroupJoinCode(storage = globalThis.sessionStorage) {
  const raw = storage?.getItem?.(PENDING_GROUP_JOIN_CODE_KEY);
  return raw ? normalizeJoinCode(raw) : null;
}

export function clearPendingGroupJoinCode(storage = globalThis.sessionStorage) {
  storage?.removeItem?.(PENDING_GROUP_JOIN_CODE_KEY);
}

export function resolveIncomingGroupJoinCode({
  hash = '',
  search = '',
  storage = globalThis.sessionStorage,
} = {}) {
  return parseGroupJoinSearch(search) || parseGroupJoinHash(hash) || readPendingGroupJoinCode(storage);
}

export function resolveIncomingJoinIntent({
  hash = '',
  search = '',
  storage = globalThis.sessionStorage,
} = {}) {
  const competitionFromUrl = parseCompetitionJoinSearch(search) || parseCompetitionJoinHash(hash);
  const groupFromUrl = parseGroupJoinSearch(search) || parseGroupJoinHash(hash);
  const sessionFromUrl = parseJoinSearch(search) || parseJoinHash(hash);
  if (competitionFromUrl) return { type: 'competition', code: competitionFromUrl };
  if (groupFromUrl) return { type: 'group', code: groupFromUrl };
  if (sessionFromUrl) return { type: 'session', code: sessionFromUrl };

  const competitionStored = readPendingCompetitionJoinCode(storage);
  if (competitionStored) return { type: 'competition', code: competitionStored };
  const groupStored = readPendingGroupJoinCode(storage);
  if (groupStored) return { type: 'group', code: groupStored };
  const sessionStored = readPendingJoinCode(storage);
  if (sessionStored) return { type: 'session', code: sessionStored };
  return { type: null, code: null };
}

export function parseCompetitionJoinHash(hash) {
  const match = String(hash ?? '').match(/^#\/competition\/join\/([A-Za-z0-9]+)/i);
  return match ? normalizeJoinCode(match[1]) : null;
}

export function parseCompetitionJoinSearch(search) {
  const query = String(search ?? '');
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const raw = params.get('competitionJoin');
  return raw ? normalizeJoinCode(raw) : null;
}

export function rememberPendingCompetitionJoinCode(code, storage = globalThis.sessionStorage) {
  const normalized = normalizeJoinCode(code);
  if (!normalized) {
    storage?.removeItem?.(PENDING_COMPETITION_JOIN_CODE_KEY);
    return null;
  }
  storage?.setItem?.(PENDING_COMPETITION_JOIN_CODE_KEY, normalized);
  return normalized;
}

export function readPendingCompetitionJoinCode(storage = globalThis.sessionStorage) {
  const raw = storage?.getItem?.(PENDING_COMPETITION_JOIN_CODE_KEY);
  return raw ? normalizeJoinCode(raw) : null;
}

export function clearPendingCompetitionJoinCode(storage = globalThis.sessionStorage) {
  storage?.removeItem?.(PENDING_COMPETITION_JOIN_CODE_KEY);
}

export function buildAuthRedirectTo({
  origin,
  base = '/',
  joinCode,
  groupJoinCode,
  competitionJoinCode,
} = {}) {
  const url = new URL(base, `${origin}/`);
  const normalizedJoin = joinCode ? normalizeJoinCode(joinCode) : '';
  const normalizedGroup = groupJoinCode ? normalizeJoinCode(groupJoinCode) : '';
  const normalizedCompetition = competitionJoinCode ? normalizeJoinCode(competitionJoinCode) : '';
  if (normalizedJoin) url.searchParams.set('join', normalizedJoin);
  if (normalizedGroup) url.searchParams.set('groupJoin', normalizedGroup);
  if (normalizedCompetition) url.searchParams.set('competitionJoin', normalizedCompetition);
  return url.toString();
}

export function cloudJoinPath(joinCode) {
  return `#/join/${normalizeJoinCode(joinCode)}`;
}

export function cloudGroupJoinPath(joinCode) {
  return `#/group/join/${normalizeJoinCode(joinCode)}`;
}

export function cloudCompetitionJoinPath(joinCode) {
  return `#/competition/join/${normalizeJoinCode(joinCode)}`;
}
