import { useEffect, useRef, useState } from 'react';
import {
  createdCloudCompetitionId,
  fetchOpenCloudCompetition,
  shouldApplyCompetitionLoad,
} from './cloudCompetitionPanel.js';
import {
  joinCloudCompetitionByCode,
  listCloudCompetitions,
  loadCloudCompetition,
} from './supabase/competitionApi.js';
import { isCanonicalJoinCode, normalizeJoinCode } from './supabase/joinCode.js';
import useCloudCompetitionRealtime from './hooks/useCloudCompetitionRealtime.js';
import CloudCompetitionCreateForm from './CloudCompetitionCreateForm.jsx';
import CloudCompetitionDetail from './CloudCompetitionDetail.jsx';
import EmptyState from './ui/EmptyState.jsx';
import EntityCard from './ui/EntityCard.jsx';
import ErrorState from './ui/ErrorState.jsx';
import LoadingState from './ui/LoadingState.jsx';
import PageHeader from './ui/PageHeader.jsx';
import { formatSessionDate } from './teamGameSessions.js';

export function CloudCompetitionOpenPanel({
  competitionLoading,
  competitionError,
  loaded,
  user,
  onBack,
  onRetry,
  onReload,
}) {
  if (competitionLoading) {
    return <LoadingState label="Carregando competição..." />;
  }

  if (competitionError || !loaded) {
    return (
      <ErrorState
        message={competitionError || 'Não foi possível abrir a competição.'}
        onBack={onBack}
        backLabel="← Competições"
        onRetry={onRetry}
      />
    );
  }

  return (
    <CloudCompetitionDetail
      loaded={loaded}
      user={user}
      onBack={onBack}
      onReload={onReload}
    />
  );
}

export default function CloudCompetitionsView({
  configured,
  ready,
  user,
  pendingCompetitionJoinCode,
  openCompetitionId,
  onOpenCompetition,
}) {
  const [competitions, setCompetitions] = useState([]);
  const [loaded, setLoaded] = useState(null);
  const [competitionLoading, setCompetitionLoading] = useState(false);
  const [competitionError, setCompetitionError] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const userId = user?.id ?? null;
  const openIdRef = useRef(openCompetitionId);

  useEffect(() => {
    openIdRef.current = openCompetitionId;
  }, [openCompetitionId]);

  async function refreshList() {
    const result = await listCloudCompetitions();
    if (result.ok) setCompetitions(result.competitions);
    else setStatus(result.error?.message || 'Não foi possível listar as competições.');
  }

  async function refreshCompetition(competitionId, { keepCompetition = false } = {}) {
    if (!competitionId || !userId) {
      setLoaded(null);
      setCompetitionError(null);
      setCompetitionLoading(false);
      return;
    }

    if (!keepCompetition) {
      setLoaded(null);
      setCompetitionError(null);
      setCompetitionLoading(true);
    }
    try {
      const result = await fetchOpenCloudCompetition(loadCloudCompetition, competitionId, userId);
      if (!shouldApplyCompetitionLoad(competitionId, openIdRef.current)) return;
      if (result.ok) {
        setLoaded(result.loaded);
        setCompetitionError(null);
      } else {
        setLoaded(null);
        setCompetitionError(result.error);
      }
    } catch (error) {
      if (!shouldApplyCompetitionLoad(competitionId, openIdRef.current)) return;
      setLoaded(null);
      setCompetitionError(error?.message || 'Não foi possível abrir a competição.');
    } finally {
      if (shouldApplyCompetitionLoad(competitionId, openIdRef.current)) setCompetitionLoading(false);
    }
  }

  useEffect(() => {
    if (!userId) {
      setCompetitions([]);
      setLoaded(null);
      setCompetitionError(null);
      setCompetitionLoading(false);
      return undefined;
    }
    refreshList();
    return undefined;
  }, [userId]);

  useEffect(() => {
    if (!userId || !openCompetitionId) {
      setLoaded(null);
      setCompetitionError(null);
      setCompetitionLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoaded(null);
    setCompetitionError(null);
    setCompetitionLoading(true);

    (async () => {
      try {
        const result = await fetchOpenCloudCompetition(loadCloudCompetition, openCompetitionId, userId);
        if (cancelled || !shouldApplyCompetitionLoad(openCompetitionId, openIdRef.current)) return;
        if (result.ok) {
          setLoaded(result.loaded);
          setCompetitionError(null);
        } else {
          setLoaded(null);
          setCompetitionError(result.error);
        }
      } catch (error) {
        if (cancelled) return;
        setLoaded(null);
        setCompetitionError(error?.message || 'Não foi possível abrir a competição.');
      } finally {
        if (!cancelled) setCompetitionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, openCompetitionId]);

  useCloudCompetitionRealtime(loaded, setLoaded, userId);

  void configured;
  void ready;
  void pendingCompetitionJoinCode;

  if (!user) return null;

  if (openCompetitionId) {
    return (
      <CloudCompetitionOpenPanel
        competitionLoading={competitionLoading}
        competitionError={competitionError}
        loaded={loaded}
        user={user}
        onBack={() => onOpenCompetition?.(null)}
        onRetry={() => refreshCompetition(openCompetitionId)}
        onReload={() => refreshCompetition(loaded?.competition?.id ?? openCompetitionId, { keepCompetition: true })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competições"
        action={
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className="min-h-11 px-4 rounded-xl text-small font-bold cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
          >
            {creating ? 'Fechar' : 'Nova competição'}
          </button>
        }
      />
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        Pertencer a um grupo não abre a competição automaticamente.
      </p>

      {creating ? (
        <CloudCompetitionCreateForm
          user={user}
          heading="Nova competição"
          onCreated={async (competitionId) => {
            setCreating(false);
            await refreshList();
            onOpenCompetition?.(competitionId);
          }}
        />
      ) : null}

      <form
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setStatus('');
          try {
            const code = normalizeJoinCode(joinCode);
            if (!isCanonicalJoinCode(code)) {
              setStatus('O código do convite é inválido.');
              return;
            }
            const joined = await joinCloudCompetitionByCode(code);
            const competitionId = createdCloudCompetitionId(joined);
            if (!joined.ok || !competitionId) {
              setStatus(joined.error?.message || 'Não foi possível entrar na competição.');
              return;
            }
            setJoinCode('');
            await refreshList();
            onOpenCompetition?.(competitionId);
          } catch (error) {
            setStatus(error?.message || 'Não foi possível entrar na competição.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="font-bold text-sm">Entrar por código</h3>
        <input
          value={joinCode}
          onChange={(event) => setJoinCode(normalizeJoinCode(event.target.value))}
          placeholder="Código da competição"
          className="w-full border p-2 rounded text-sm outline-none uppercase"
          style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          Entrar na competição
        </button>
      </form>

      <div className="space-y-2">
        {competitions.length === 0 ? (
          <EmptyState
            title="Você ainda não tem competições"
            description="Crie uma competição para gerar chave, registrar partidas e acompanhar o campeão."
            actionLabel="Criar primeira competição"
            onAction={() => setCreating(true)}
          />
        ) : (
          competitions.map((item) => (
            <EntityCard
              key={item.id}
              title={item.name || 'Competição'}
              dateLabel={formatSessionDate(item.date)}
              status={item.status}
              meta={item.groupId ? 'Grupo' : 'Avulsa'}
              onClick={() => onOpenCompetition?.(item.id)}
            />
          ))
        )}
      </div>
      {status ? (
        <p className="text-sm font-semibold text-red-500">{status}</p>
      ) : null}
    </div>
  );
}
