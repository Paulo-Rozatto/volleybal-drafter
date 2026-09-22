const listeners = new Set();

export function showToast(message) {
  const text = String(message ?? '').trim();
  if (!text) return;
  for (const listener of listeners) listener(text);
}

export function subscribeToast(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
