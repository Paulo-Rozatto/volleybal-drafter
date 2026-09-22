import { useEffect, useRef, useState } from 'react';
import CloudSessionCreateForm from './CloudSessionCreateForm.jsx';
import CloudSessionDetail from './CloudSessionDetail.jsx';
import {
  fetchOpenCloudSession,
  shouldApplySessionLoad,
} from './cloudSessionPanel.js';
import { listCloudSessions, loadCloudSession } from './supabase/sessionApi.js';
import useCloudSessionRealtime from './hooks/useCloudSessionRealtime.js';
import EmptyState from './ui/EmptyState.jsx';
import EntityCard from './ui/EntityCard.jsx';
import ErrorState from './ui/ErrorState.jsx';
import LoadingState from './ui/LoadingState.jsx';
import PageHeader from './ui/PageHeader.jsx';
import { formatSessionDate } from './teamGameSessions.js';

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
    return <LoadingState label="Carregando encontro..." />;
  }

  if (sessionError || !session) {
    return (
      <ErrorState
        message={sessionError || 'Não foi possível abrir o encontro.'}
        onBack={onBack}
        backLabel="← Encontros"
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-small font-bold cursor-pointer min-h-11"
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
  const [creating, setCreating] = useState(false);
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

  void configured;
  void ready;
  void pendingJoinCode;

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
      <PageHeader
        title="Encontros"
        action={
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className="min-h-11 px-4 rounded-xl text-small font-bold cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
          >
            {creating ? 'Fechar' : 'Novo encontro'}
          </button>
        }
      />
      {legacyNotice}

      {creating ? (
        <CloudSessionCreateForm
          user={user}
          heading="Novo encontro"
          onCreated={async (sessionId) => {
            setCreating(false);
            await refreshList();
            onOpenSession?.(sessionId);
          }}
        />
      ) : null}

      <div className="space-y-2">
        {sessions.length === 0 ? (
          <EmptyState
            title="Você ainda não tem encontros"
            description="Crie um encontro para registrar times, partidas e placares."
            actionLabel="Criar primeiro encontro"
            onAction={() => setCreating(true)}
          />
        ) : (
          sessions.map((item) => (
            <EntityCard
              key={item.id}
              title={item.name || 'Encontro'}
              dateLabel={formatSessionDate(item.date)}
              status={item.status}
              meta={item.group_id ? 'Grupo' : null}
              onClick={() => onOpenSession?.(item.id)}
            />
          ))
        )}
      </div>
      {status ? (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
