import { useCallback, useEffect, useRef, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import { CloudGroupOpenPanel } from './CloudGroupDetail.jsx';
import {
  createdCloudGroupId,
  fetchOpenCloudGroup,
  shouldApplyGroupListLoad,
  shouldApplyGroupLoad,
} from './cloudGroupPanel.js';
import {
  createGroup,
  joinGroupByCode,
  listGroupSessions,
  listMyGroups,
  loadGroup,
} from './supabase/groupApi.js';
import { listGroupCloudCompetitions } from './supabase/competitionApi.js';
import { isCanonicalJoinCode, normalizeJoinCode } from './supabase/joinCode.js';
import { groupRoleLabel } from './supabase/groupMappers.js';

function memberCountLabel(count) {
  return `${count} ${count === 1 ? 'membro' : 'membros'}`;
}

export default function CloudGroupsView({
  configured,
  ready,
  user,
  pendingGroupJoinCode,
  openGroupId,
  onOpenGroup,
  onOpenSession,
  onOpenCompetition,
}) {
  const [groups, setGroups] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [group, setGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [competitions, setCompetitions] = useState([]);
  const [competitionsLoading, setCompetitionsLoading] = useState(false);
  const [competitionsError, setCompetitionsError] = useState(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const userId = user?.id ?? null;
  const openIdRef = useRef(openGroupId);
  const userIdRef = useRef(userId);

  useEffect(() => {
    openIdRef.current = openGroupId;
  }, [openGroupId]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const refreshList = useCallback(async () => {
    const requestUserId = userId;
    if (!requestUserId) {
      setGroups([]);
      setListError(null);
      setListLoading(false);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const result = await listMyGroups(requestUserId);
      if (!shouldApplyGroupListLoad(requestUserId, userIdRef.current)) return;
      if (result.ok) {
        setGroups(result.groups);
        setListError(null);
      } else {
        setGroups([]);
        setListError(result.error?.message || 'Não foi possível listar os grupos.');
      }
    } catch (error) {
      if (!shouldApplyGroupListLoad(requestUserId, userIdRef.current)) return;
      setGroups([]);
      setListError(error?.message || 'Não foi possível listar os grupos.');
    } finally {
      if (shouldApplyGroupListLoad(requestUserId, userIdRef.current)) setListLoading(false);
    }
  }, [userId]);

  async function refreshGroup(groupId, { keepGroup = false } = {}) {
    if (!groupId || !userId) {
      setGroup(null);
      setGroupError(null);
      setGroupLoading(false);
      setSessions([]);
      setSessionsError(null);
      setSessionsLoading(false);
      setCompetitions([]);
      setCompetitionsError(null);
      setCompetitionsLoading(false);
      return;
    }

    if (!keepGroup) {
      setGroup(null);
      setGroupError(null);
      setGroupLoading(true);
    }

    try {
      const result = await fetchOpenCloudGroup(loadGroup, groupId, userId);
      if (!shouldApplyGroupLoad(groupId, openIdRef.current)) return;
      if (result.ok) {
        setGroup(result.group);
        setGroupError(null);
      } else {
        setGroup(null);
        setGroupError(result.error);
      }
    } catch (error) {
      if (!shouldApplyGroupLoad(groupId, openIdRef.current)) return;
      setGroup(null);
      setGroupError(error?.message || 'Não foi possível abrir o grupo.');
    } finally {
      if (shouldApplyGroupLoad(groupId, openIdRef.current)) setGroupLoading(false);
    }

    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const listed = await listGroupSessions(groupId);
      if (!shouldApplyGroupLoad(groupId, openIdRef.current)) return;
      if (listed.ok) {
        setSessions(listed.sessions);
        setSessionsError(null);
      } else {
        setSessions([]);
        setSessionsError(listed.error?.message || 'Não foi possível listar os encontros do grupo.');
      }
    } catch (error) {
      if (!shouldApplyGroupLoad(groupId, openIdRef.current)) return;
      setSessions([]);
      setSessionsError(error?.message || 'Não foi possível listar os encontros do grupo.');
    } finally {
      if (shouldApplyGroupLoad(groupId, openIdRef.current)) setSessionsLoading(false);
    }

    setCompetitionsLoading(true);
    setCompetitionsError(null);
    try {
      const listedCompetitions = await listGroupCloudCompetitions(groupId);
      if (!shouldApplyGroupLoad(groupId, openIdRef.current)) return;
      if (listedCompetitions.ok) {
        setCompetitions(listedCompetitions.competitions);
        setCompetitionsError(null);
      } else {
        setCompetitions([]);
        setCompetitionsError(listedCompetitions.error?.message || 'Não foi possível listar as competições do grupo.');
      }
    } catch (error) {
      if (!shouldApplyGroupLoad(groupId, openIdRef.current)) return;
      setCompetitions([]);
      setCompetitionsError(error?.message || 'Não foi possível listar as competições do grupo.');
    } finally {
      if (shouldApplyGroupLoad(groupId, openIdRef.current)) setCompetitionsLoading(false);
    }
  }

  useEffect(() => {
    if (!userId) {
      setGroups([]);
      setListError(null);
      setListLoading(false);
      return undefined;
    }
    refreshList();
    return undefined;
  }, [userId, refreshList]);

  useEffect(() => {
    if (!userId || !openGroupId) {
      setGroup(null);
      setGroupError(null);
      setGroupLoading(false);
      setSessions([]);
      setSessionsError(null);
      setSessionsLoading(false);
      setCompetitions([]);
      setCompetitionsError(null);
      setCompetitionsLoading(false);
      return undefined;
    }

    let cancelled = false;
    setGroup(null);
    setGroupError(null);
    setGroupLoading(true);
    setSessions([]);
    setSessionsError(null);
    setSessionsLoading(true);
    setCompetitions([]);
    setCompetitionsError(null);
    setCompetitionsLoading(true);
    setCompetitions([]);
    setCompetitionsError(null);
    setCompetitionsLoading(true);

    (async () => {
      try {
        const result = await fetchOpenCloudGroup(loadGroup, openGroupId, userId);
        if (cancelled || !shouldApplyGroupLoad(openGroupId, openIdRef.current)) return;
        if (result.ok) {
          setGroup(result.group);
          setGroupError(null);
        } else {
          setGroup(null);
          setGroupError(result.error);
        }
      } catch (error) {
        if (cancelled || !shouldApplyGroupLoad(openGroupId, openIdRef.current)) return;
        setGroup(null);
        setGroupError(error?.message || 'Não foi possível abrir o grupo.');
      } finally {
        if (!cancelled && shouldApplyGroupLoad(openGroupId, openIdRef.current)) setGroupLoading(false);
      }

      try {
        const listed = await listGroupSessions(openGroupId);
        if (cancelled || !shouldApplyGroupLoad(openGroupId, openIdRef.current)) return;
        if (listed.ok) {
          setSessions(listed.sessions);
          setSessionsError(null);
        } else {
          setSessions([]);
          setSessionsError(listed.error?.message || 'Não foi possível listar os encontros do grupo.');
        }
      } catch (error) {
        if (cancelled || !shouldApplyGroupLoad(openGroupId, openIdRef.current)) return;
        setSessions([]);
        setSessionsError(error?.message || 'Não foi possível listar os encontros do grupo.');
      } finally {
        if (!cancelled && shouldApplyGroupLoad(openGroupId, openIdRef.current)) setSessionsLoading(false);
      }

      try {
        const listedCompetitions = await listGroupCloudCompetitions(openGroupId);
        if (cancelled || !shouldApplyGroupLoad(openGroupId, openIdRef.current)) return;
        if (listedCompetitions.ok) {
          setCompetitions(listedCompetitions.competitions);
          setCompetitionsError(null);
        } else {
          setCompetitions([]);
          setCompetitionsError(
            listedCompetitions.error?.message || 'Não foi possível listar as competições do grupo.'
          );
        }
      } catch (error) {
        if (cancelled || !shouldApplyGroupLoad(openGroupId, openIdRef.current)) return;
        setCompetitions([]);
        setCompetitionsError(error?.message || 'Não foi possível listar as competições do grupo.');
      } finally {
        if (!cancelled && shouldApplyGroupLoad(openGroupId, openIdRef.current)) setCompetitionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, openGroupId]);

  if (!user) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Grupos</h2>
        <AuthPanel
          configured={configured}
          ready={ready}
          user={user}
          pendingGroupJoinCode={pendingGroupJoinCode}
        />
      </div>
    );
  }

  if (openGroupId) {
    return (
      <CloudGroupOpenPanel
        key={openGroupId}
        groupLoading={groupLoading}
        groupError={groupError}
        group={group}
        sessionsLoading={sessionsLoading}
        sessionsError={sessionsError}
        sessions={sessions}
        competitionsLoading={competitionsLoading}
        competitionsError={competitionsError}
        competitions={competitions}
        user={user}
        onBack={() => onOpenGroup?.(null)}
        onRetry={() => refreshGroup(openGroupId)}
        onReload={() => refreshGroup(group?.id ?? openGroupId, { keepGroup: true })}
        onOpenSession={onOpenSession}
        onOpenCompetition={onOpenCompetition}
        onLeftGroup={() => {
          onOpenGroup?.(null);
          refreshList();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Grupos</h2>
      <AuthPanel configured={configured} ready={ready} user={user} />

      <form
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setStatus('');
          try {
            const created = await createGroup({
              name: createName,
              description: createDescription,
            });
            const groupId = createdCloudGroupId(created);
            if (!created.ok || !groupId) {
              setStatus(created.error?.message || 'Não foi possível criar o grupo.');
              return;
            }
            setCreateName('');
            setCreateDescription('');
            await refreshList();
            onOpenGroup?.(groupId);
          } catch (error) {
            setStatus(error?.message || 'Não foi possível criar o grupo.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="font-bold text-sm">Criar grupo</h3>
        <input
          required
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          placeholder="Nome"
          className="w-full border p-2 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <textarea
          value={createDescription}
          onChange={(event) => setCreateDescription(event.target.value)}
          placeholder="Descrição (opcional)"
          rows={2}
          className="w-full border p-2 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          Criar grupo
        </button>
      </form>

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
            const joined = await joinGroupByCode(code);
            if (!joined.ok || !joined.groupId) {
              setStatus(joined.error?.message || 'Não foi possível entrar no grupo.');
              return;
            }
            setJoinCode('');
            await refreshList();
            onOpenGroup?.(joined.groupId);
          } catch (error) {
            setStatus(error?.message || 'Não foi possível entrar no grupo.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="font-bold text-sm">Entrar com código</h3>
        <input
          value={joinCode}
          onChange={(event) => setJoinCode(normalizeJoinCode(event.target.value))}
          placeholder="Código do grupo"
          className="w-full border p-2 rounded text-sm outline-none uppercase"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
        >
          Entrar no grupo
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="font-bold text-sm">Meus grupos</h3>
        {listLoading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Carregando grupos...
          </p>
        ) : null}
        {listError ? <p className="text-sm font-semibold text-red-500">{listError}</p> : null}
        {!listLoading && !listError && groups.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Você ainda não participa de um grupo.
          </p>
        ) : null}
        {groups.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenGroup?.(item.id)}
            className="w-full text-left p-3 rounded-xl border cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <p className="font-semibold">{item.name}</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {memberCountLabel(item.memberCount)}
              {item.myRole ? ` · ${groupRoleLabel(item.myRole)}` : ''}
            </p>
          </button>
        ))}
      </div>
      {status ? (
        <p className="text-sm font-semibold text-red-500">{status}</p>
      ) : null}
    </div>
  );
}
