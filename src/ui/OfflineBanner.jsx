import { useEffect, useState } from 'react';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    globalThis.addEventListener?.('online', on);
    globalThis.addEventListener?.('offline', off);
    return () => {
      globalThis.removeEventListener?.('online', on);
      globalThis.removeEventListener?.('offline', off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="px-4 py-2 text-center text-small font-semibold"
      style={{ backgroundColor: 'var(--warning)', color: '#1c1917' }}
    >
      Sem conexão
    </div>
  );
}
