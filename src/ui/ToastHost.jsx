import { useEffect, useState } from 'react';
import { subscribeToast } from './toast.js';

export default function ToastHost() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let timer;
    return subscribeToast((next) => {
      setMessage(next);
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => setMessage(''), 2800);
    });
  }, []);

  if (!message) return null;

  return (
    <div
      role="status"
      className="fixed bottom-24 md:bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-small font-semibold shadow-lg"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        color: 'var(--text-main)',
        border: '1px solid var(--border-color)',
      }}
    >
      {message}
    </div>
  );
}
