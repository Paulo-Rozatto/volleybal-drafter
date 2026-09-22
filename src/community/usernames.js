const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function normalizeUsernameInput(value) {
  return String(value ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

export function isValidUsername(value) {
  return USERNAME_PATTERN.test(normalizeUsernameInput(value));
}

export function formatUsername(value) {
  const normalized = normalizeUsernameInput(value);
  return normalized ? `@${normalized}` : '';
}
