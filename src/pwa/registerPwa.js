export function registerPwa() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  const base = import.meta.env.BASE_URL || '/';
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
  });
}
