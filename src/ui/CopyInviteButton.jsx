import { useState } from 'react';
import Button from './Button.jsx';
import { showToast } from './toast.js';

export default function CopyInviteButton({ href, code, label = 'Copiar convite' }) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        const text = href || code || '';
        if (!text) return;
        setBusy(true);
        try {
          await globalThis.navigator?.clipboard?.writeText?.(text);
          showToast('Convite copiado.');
        } catch {
          showToast(text);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
