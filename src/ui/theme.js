import { BRAND_THEME_STORAGE_KEY } from './brand.js';

export const THEME_OPTIONS = Object.freeze(['system', 'light', 'dark']);

export function readStoredTheme() {
  try {
    const value = globalThis.localStorage?.getItem?.(BRAND_THEME_STORAGE_KEY);
    return THEME_OPTIONS.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const next = THEME_OPTIONS.includes(theme) ? theme : 'system';
  const root = globalThis.document?.documentElement;
  if (!root) return next;
  if (next === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', next);
  return next;
}

export function persistTheme(theme) {
  const next = applyTheme(theme);
  try {
    globalThis.localStorage?.setItem?.(BRAND_THEME_STORAGE_KEY, next);
  } catch {
    // UI preference only
  }
  return next;
}
