import { useEffect, useRef, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import CloudProfileView from './CloudProfileView.jsx';
import CloudSessionDetail from './CloudSessionDetail.jsx';
import {
  createdCloudSessionId,
  fetchOpenCloudSession,
  shouldApplySessionLoad,
} from './cloudSessionPanel.js';
import { localDateString } from './teamGameSessions.js';
import { createCloudSession, listCloudSessions, loadCloudSession } from './supabase/sessionApi.js';
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
            ← Encontros online
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
        ← Encontros online
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
}) {
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState(null);
  const [form, setForm] = useState(() => ({
    date: localDateString(),
    name: '',
    teamSize: 2,
    teamCount: 2,
  }));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
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
        <h2 className="text-xl font-bold">Encontros online</h2>
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
      <h2 className="text-xl font-bold">Encontros online</h2>
      <AuthPanel configured={configured} ready={ready} user={user} />
      {user ? <CloudProfileView user={user} /> : null}

      <form
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setStatus('');
          try {
            const created = await createCloudSession({
              ...form,
              createdBy: user.id,
            });
            if (!created.ok) {
              setStatus(created.error?.message || 'Não foi possível criar o encontro.');
              return;
            }
            const sessionId = createdCloudSessionId(created);
            if (!sessionId) {
              setStatus('O encontro foi criado, mas o identificador não voltou no resultado.');
              return;
            }
            await refreshList();
            onOpenSession?.(sessionId);
          } catch (error) {
            setStatus(error?.message || 'Não foi possível criar o encontro.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="font-bold text-sm">Novo encontro</h3>
        <input
          type="date"
          value={form.date}
          onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          className="w-full border p-2 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <input
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Nome (opcional)"
          className="w-full border p-2 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <div className="flex gap-2">
          <select
            value={form.teamSize}
            onChange={(event) =>
              setForm((current) => ({ ...current, teamSize: Number(event.target.value) }))
            }
            className="flex-1 border p-2 rounded text-sm outline-none"
            style={{
              backgroundColor: 'var(--bg-app)',
              color: 'var(--text-main)',
              borderColor: 'var(--border-color)',
            }}
          >
            {[2, 3, 4, 5, 6].map((size) => (
              <option key={size} value={size}>
                {size}x{size}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="2"
            value={form.teamCount}
            onChange={(event) =>
              setForm((current) => ({ ...current, teamCount: Number(event.target.value) }))
            }
            className="w-24 border p-2 rounded text-sm outline-none"
            style={{
              backgroundColor: 'var(--bg-app)',
              color: 'var(--text-main)',
              borderColor: 'var(--border-color)',
            }}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          Criar encontro
        </button>
      </form>

      <div className="space-y-2">
        {sessions.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Você ainda não participa de um encontro online.
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
