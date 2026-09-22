import React, { useEffect, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import { isCanonicalJoinCode, normalizeJoinCode, rememberPendingJoinCode } from './supabase/joinCode.js';
import { joinCloudSessionByCode } from './supabase/sessionApi.js';

export default function JoinSessionView({
  joinCode,
  configured,
  ready,
  user,
  onJoined,
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const normalized = normalizeJoinCode(joinCode);

  useEffect(() => {
    if (normalized) rememberPendingJoinCode(normalized);
  }, [normalized]);

  useEffect(() => {
    if (!user || !normalized || !isCanonicalJoinCode(normalized)) return undefined;
    let cancelled = false;
    setBusy(true);
    joinCloudSessionByCode(normalized).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (result.ok) {
        onJoined?.(result.sessionId);
        return;
      }
      setStatus(result.error?.message || 'Não foi possível entrar no encontro.');
    });
    return () => {
      cancelled = true;
    };
  }, [user, normalized, onJoined]);

  if (!isCanonicalJoinCode(normalized)) {
    return (
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        Código de convite inválido.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-h1">Você recebeu um convite para um encontro</h2>
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        Depois do login, o acesso é retomado automaticamente.
      </p>
      {!user ? (
        <AuthPanel
          configured={configured}
          ready={ready}
          user={user}
          pendingJoinCode={normalized}
          variant="compact"
        />
      ) : (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          {busy ? 'Validando convite...' : status}
        </p>
      )}
    </div>
  );
}
