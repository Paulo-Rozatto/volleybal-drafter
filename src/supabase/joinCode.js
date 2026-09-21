const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export const PENDING_JOIN_CODE_KEY = 'volleyPendingJoinCode';

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

export function buildAuthRedirectTo({
  origin,
  base = '/',
  joinCode,
} = {}) {
  const url = new URL(base, `${origin}/`);
  const normalized = joinCode ? normalizeJoinCode(joinCode) : '';
  if (normalized) url.searchParams.set('join', normalized);
  return url.toString();
}

export function cloudJoinPath(joinCode) {
  return `#/join/${normalizeJoinCode(joinCode)}`;
}
