import { useEffect, useRef, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import { isCanonicalJoinCode, normalizeJoinCode, rememberPendingGroupJoinCode } from './supabase/joinCode.js';
import { joinGroupByCode } from './supabase/groupApi.js';

export default function JoinGroupView({
  joinCode,
  configured,
  ready,
  user,
  onJoined,
}) {
  const [status, setStatus] = useState('');
  const [joining, setJoining] = useState(false);
  const normalized = normalizeJoinCode(joinCode);
  const codeRef = useRef(normalized);

  useEffect(() => {
    codeRef.current = normalized;
  }, [normalized]);

  useEffect(() => {
    if (normalized) rememberPendingGroupJoinCode(normalized);
  }, [normalized]);

  useEffect(() => {
    if (!user || !normalized || !isCanonicalJoinCode(normalized)) {
      setJoining(false);
      return undefined;
    }

    let cancelled = false;
    setJoining(true);
    setStatus('');

    (async () => {
      try {
        const result = await joinGroupByCode(normalized);
        if (cancelled || codeRef.current !== normalized) return;
        if (result.ok && result.groupId) {
          onJoined?.(result.groupId);
          return;
        }
        setStatus(result.error?.message || 'Não foi possível entrar no grupo.');
      } catch (error) {
        if (cancelled || codeRef.current !== normalized) return;
        setStatus(error?.message || 'Não foi possível entrar no grupo.');
      } finally {
        if (!cancelled && codeRef.current === normalized) setJoining(false);
      }
    })();

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
      <h2 className="text-h1">Você recebeu um convite para um grupo</h2>
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        Depois do login, o acesso é retomado automaticamente.
      </p>
      {!user ? (
        <AuthPanel
          configured={configured}
          ready={ready}
          user={user}
          pendingGroupJoinCode={normalized}
          variant="compact"
        />
      ) : joining ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Validando convite...
        </p>
      ) : status ? (
        <p className="text-sm font-semibold text-red-500">{status}</p>
      ) : null}
    </div>
  );
}
