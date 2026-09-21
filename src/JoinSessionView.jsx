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
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Código de convite inválido.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Entrar no encontro {normalized}</h2>
      {!user ? (
        <AuthPanel
          configured={configured}
          ready={ready}
          user={user}
          pendingJoinCode={normalized}
        />
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {busy ? 'Validando convite...' : status}
        </p>
      )}
    </div>
  );
}
