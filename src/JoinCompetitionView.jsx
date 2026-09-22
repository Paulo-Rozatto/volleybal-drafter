import { useEffect, useRef, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import { isCanonicalJoinCode, normalizeJoinCode, rememberPendingCompetitionJoinCode } from './supabase/joinCode.js';
import { joinCloudCompetitionByCode } from './supabase/competitionApi.js';

export default function JoinCompetitionView({
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
    if (normalized) rememberPendingCompetitionJoinCode(normalized);
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
        const result = await joinCloudCompetitionByCode(normalized);
        if (cancelled || codeRef.current !== normalized) return;
        if (result.ok && result.competitionId) {
          onJoined?.(result.competitionId);
          return;
        }
        setStatus(result.error?.message || 'Não foi possível entrar na competição.');
      } catch (error) {
        if (cancelled || codeRef.current !== normalized) return;
        setStatus(error?.message || 'Não foi possível entrar na competição.');
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
      <h2 className="text-xl font-bold">Entrar na competição {normalized}</h2>
      {!user ? (
        <AuthPanel
          configured={configured}
          ready={ready}
          user={user}
          pendingCompetitionJoinCode={normalized}
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
