import { useEffect, useRef, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import CloudSessionDetail from './CloudSessionDetail.jsx';
import CloudSessionCreateForm from './CloudSessionCreateForm.jsx';
import {
  fetchOpenCloudSession,
  shouldApplySessionLoad,
} from './cloudSessionPanel.js';
import { listCloudSessions, loadCloudSession } from './supabase/sessionApi.js';
import useCloudSessionRealtime from './hooks/useCloudSessionRealtime.js';

export function CloudSessionOpenPanel({
  sessionLoading,
  sessionError,
  session,
  user,
  onBack,
  onRetry,
  onReload,
}) {
  if (sessionLoading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Carregando encontro...
      </p>
    );
  }

  if (sessionError || !session) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-red-500">
          {sessionError || 'Não foi possível abrir o encontro.'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            ← Encontros
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold cursor-pointer"
        style={{ color: 'var(--primary)' }}
      >
        ← Encontros
      </button>
      <CloudSessionDetail session={session} user={user} onReload={onReload} />
    </div>
  );
}

export default function CloudSessionsView({
  configured,
  ready,
  user,
  pendingJoinCode,
  openSessionId,
  onOpenSession,
  legacyNotice = null,
}) {
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState(null);
  const [status, setStatus] = useState('');
  const userId = user?.id ?? null;
  const openIdRef = useRef(openSessionId);

  useEffect(() => {
    openIdRef.current = openSessionId;
  }, [openSessionId]);

  async function refreshList() {
    const result = await listCloudSessions();
    if (result.ok) setSessions(result.sessions);
    else setStatus(result.error?.message || 'Não foi possível listar os encontros.');
  }

  async function refreshSession(sessionId, { keepSession = false } = {}) {
    if (!sessionId || !userId) {
      setSession(null);
      setSessionError(null);
      setSessionLoading(false);
      return;
    }

    if (!keepSession) {
      setSession(null);
      setSessionError(null);
      setSessionLoading(true);
    }
    try {
      const result = await fetchOpenCloudSession(loadCloudSession, sessionId, userId);
      if (!shouldApplySessionLoad(sessionId, openIdRef.current)) return;
      if (result.ok) {
        setSession(result.session);
        setSessionError(null);
      } else {
        setSession(null);
        setSessionError(result.error);
      }
    } catch (error) {
      if (!shouldApplySessionLoad(sessionId, openIdRef.current)) return;
      setSession(null);
      setSessionError(error?.message || 'Não foi possível abrir o encontro.');
    } finally {
      if (shouldApplySessionLoad(sessionId, openIdRef.current)) setSessionLoading(false);
    }
  }

  useEffect(() => {
    if (!userId) {
      setSessions([]);
      setSession(null);
      setSessionError(null);
      setSessionLoading(false);
      return undefined;
    }
    refreshList();
    return undefined;
  }, [userId]);

  useEffect(() => {
    if (!userId || !openSessionId) {
      setSession(null);
      setSessionError(null);
      setSessionLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSession(null);
    setSessionError(null);
    setSessionLoading(true);

    (async () => {
      try {
        const result = await fetchOpenCloudSession(loadCloudSession, openSessionId, userId);
        if (cancelled || !shouldApplySessionLoad(openSessionId, openIdRef.current)) return;
        if (result.ok) {
          setSession(result.session);
          setSessionError(null);
        } else {
          setSession(null);
          setSessionError(result.error);
        }
      } catch (error) {
        if (cancelled) return;
        setSession(null);
        setSessionError(error?.message || 'Não foi possível abrir o encontro.');
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, openSessionId]);

  useCloudSessionRealtime(session, setSession, userId);

  if (!user) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Encontros</h2>
        <AuthPanel
          configured={configured}
          ready={ready}
          user={user}
          pendingJoinCode={pendingJoinCode}
        />
      </div>
    );
  }

  if (openSessionId) {
    return (
      <CloudSessionOpenPanel
        sessionLoading={sessionLoading}
        sessionError={sessionError}
        session={session}
        user={user}
        onBack={() => onOpenSession?.(null)}
        onRetry={() => refreshSession(openSessionId)}
        onReload={() => refreshSession(session?.id ?? openSessionId, { keepSession: true })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Encontros</h2>
      <AuthPanel configured={configured} ready={ready} user={user} />
      {legacyNotice}

      <CloudSessionCreateForm
        user={user}
        heading="Novo encontro avulso"
        onCreated={async (sessionId) => {
          await refreshList();
          onOpenSession?.(sessionId);
        }}
      />

      <div className="space-y-2">
        {sessions.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Você ainda não participa de um encontro.
          </p>
        ) : (
          sessions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenSession?.(item.id)}
              className="w-full text-left p-3 rounded-xl border cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="font-semibold">{item.name || 'Encontro'}</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {item.date} · {item.status} · {item.join_code}
              </p>
            </button>
          ))
        )}
      </div>
      {status ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
