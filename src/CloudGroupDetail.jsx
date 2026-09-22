import { useState } from 'react';
import CloudGroupRanking from './CloudGroupRanking.jsx';
import CloudSessionCreateForm from './CloudSessionCreateForm.jsx';
import CloudCompetitionCreateForm from './CloudCompetitionCreateForm.jsx';
import {
  canManageGroup,
  groupRoleLabel,
} from './supabase/groupMappers.js';
import { cloudGroupJoinPath } from './supabase/joinCode.js';
import {
  leaveGroup,
  removeGroupMember,
  rotateGroupJoinCode,
  setGroupMemberRole,
  updateGroup,
} from './supabase/groupApi.js';

function memberCountLabel(count) {
  return `${count} ${count === 1 ? 'membro' : 'membros'}`;
}

export function CloudGroupOpenPanel({
  groupLoading,
  groupError,
  group,
  sessionsLoading,
  sessionsError,
  sessions,
  competitionsLoading,
  competitionsError,
  competitions,
  user,
  onBack,
  onRetry,
  onReload,
  onOpenSession,
  onOpenCompetition,
  onLeftGroup,
}) {
  if (groupLoading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Carregando grupo...
      </p>
    );
  }

  if (groupError || !group) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-red-500">
          {groupError || 'Não foi possível abrir o grupo.'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            ← Grupos
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
    <CloudGroupDetail
      group={group}
      sessionsLoading={sessionsLoading}
      sessionsError={sessionsError}
      sessions={sessions}
      competitionsLoading={competitionsLoading}
      competitionsError={competitionsError}
      competitions={competitions}
      user={user}
      onBack={onBack}
      onReload={onReload}
      onOpenSession={onOpenSession}
      onOpenCompetition={onOpenCompetition}
      onLeftGroup={onLeftGroup}
    />
  );
}

export default function CloudGroupDetail({
  group,
  sessionsLoading,
  sessionsError,
  sessions = [],
  competitionsLoading,
  competitionsError,
  competitions = [],
  user,
  onBack,
  onReload,
  onOpenSession,
  onOpenCompetition,
  onLeftGroup,
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState('grupo');
  const [rankingUserId, setRankingUserId] = useState(null);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const manage = canManageGroup(group.myRole);
  const joinHref = `${globalThis.location?.origin ?? ''}${import.meta.env.BASE_URL ?? '/'}${cloudGroupJoinPath(group.joinCode)}`;

  async function run(action, { left = false } = {}) {
    setBusy(true);
    setStatus('');
    try {
      const result = await action();
      if (!result.ok) {
        setStatus(result.error?.message || 'Não foi possível concluir a operação.');
        return;
      }
      if (left) {
        onLeftGroup?.();
        return;
      }
      await onReload?.();
    } catch (error) {
      setStatus(error?.message || 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    const text = `${group.joinCode}\n${joinHref}`;
    try {
      await globalThis.navigator?.clipboard?.writeText?.(text);
      setStatus('Código copiado.');
    } catch {
      setStatus(joinHref);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold cursor-pointer"
        style={{ color: 'var(--primary)' }}
      >
        ← Grupos
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSection('grupo')}
          className="text-sm font-bold px-3 py-1 rounded-lg cursor-pointer"
          style={{
            backgroundColor: section === 'grupo' ? 'var(--primary)' : 'var(--bg-subtle)',
            color: section === 'grupo' ? 'var(--text-inverse)' : 'var(--text-main)',
          }}
        >
          Grupo
        </button>
        <button
          type="button"
          onClick={() => setSection('ranking')}
          className="text-sm font-bold px-3 py-1 rounded-lg cursor-pointer"
          style={{
            backgroundColor: section === 'ranking' ? 'var(--primary)' : 'var(--bg-subtle)',
            color: section === 'ranking' ? 'var(--text-inverse)' : 'var(--text-main)',
          }}
        >
          Ranking
        </button>
        <button
          type="button"
          onClick={() => setSection('competicoes')}
          className="text-sm font-bold px-3 py-1 rounded-lg cursor-pointer"
          style={{
            backgroundColor: section === 'competicoes' ? 'var(--primary)' : 'var(--bg-subtle)',
            color: section === 'competicoes' ? 'var(--text-inverse)' : 'var(--text-main)',
          }}
        >
          Competições
        </button>
      </div>

      {section === 'ranking' ? (
        <CloudGroupRanking
          key={group.id}
          groupId={group.id}
          selectedUserId={rankingUserId}
          onSelectUser={setRankingUserId}
        />
      ) : null}

      {section === 'competicoes' ? (
        <section className="space-y-3">
          <h3 className="font-bold text-sm">Competições</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Só aparecem competições deste grupo em que você já é competition_member. Entrar no grupo não abre a competição.
          </p>
          <CloudCompetitionCreateForm
            user={user}
            groupId={group.id}
            heading="Nova competição neste grupo"
            onCreated={onOpenCompetition}
          />
          {competitionsLoading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Carregando competições...
            </p>
          ) : null}
          {competitionsError ? (
            <p className="text-sm font-semibold text-red-500">{competitionsError}</p>
          ) : null}
          {!competitionsLoading && !competitionsError && competitions.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Você ainda não participa de uma competição deste grupo.
            </p>
          ) : null}
          {competitions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenCompetition?.(item.id)}
              className="w-full text-left p-3 rounded-xl border cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="font-semibold">{item.name || 'Competição'}</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {item.date} · {item.status}
              </p>
            </button>
          ))}
        </section>
      ) : null}

      {section === 'grupo' ? (
      <>
      <div
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        {editing ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const result = await updateGroup(group.id, { name, description });
                if (result.ok) setEditing(false);
                return result;
              });
            }}
          >
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full border p-2 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Descrição (opcional)"
              className="w-full border p-2 rounded text-sm outline-none"
              rows={3}
              style={{
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="font-bold py-2 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setName(group.name);
                  setDescription(group.description ?? '');
                }}
                className="text-sm font-bold cursor-pointer"
                style={{ color: 'var(--primary)' }}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2 className="text-xl font-bold">{group.name}</h2>
            {group.description ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {group.description}
              </p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Sem descrição.
              </p>
            )}
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              {memberCountLabel(group.memberCount)} · seu papel: {groupRoleLabel(group.myRole)}
            </p>
            {manage ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm font-bold cursor-pointer"
                style={{ color: 'var(--primary)' }}
              >
                Editar grupo
              </button>
            ) : null}
          </>
        )}
      </div>

      <div
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <p className="text-sm font-semibold">Convite: {group.joinCode}</p>
        <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>
          {joinHref}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={copyInvite}
            className="font-bold py-2 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
          >
            Copiar código
          </button>
          {manage ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => rotateGroupJoinCode(group.id))}
              className="font-bold py-2 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
            >
              Gerar novo código
            </button>
          ) : null}
        </div>
      </div>

      <section
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">Membros</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Pertencer ao grupo não entra automaticamente nos encontros nem no elenco.
        </p>
        {group.members.map((member) => {
          const canEditMember = manage && member.role !== 'owner' && member.userId !== user?.id;
          const canRemoveMember = group.myRole === 'owner' || member.role === 'member';
          return (
            <div key={member.userId} className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setRankingUserId(member.userId);
                  setSection('ranking');
                }}
                className="text-sm text-left font-semibold cursor-pointer"
                style={{ color: 'var(--primary)' }}
              >
                {member.displayName || member.userId} · {groupRoleLabel(member.role)}
              </button>
              {canEditMember ? (
                <div className="flex flex-wrap gap-2">
                  {member.role === 'member' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => setGroupMemberRole(group.id, member.userId, 'admin'))}
                      className="text-xs font-bold cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--primary)' }}
                    >
                      Promover a admin
                    </button>
                  ) : null}
                  {member.role === 'admin' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => setGroupMemberRole(group.id, member.userId, 'member'))}
                      className="text-xs font-bold cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--primary)' }}
                    >
                      Rebaixar a membro
                    </button>
                  ) : null}
                  {canRemoveMember ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => removeGroupMember(group.id, member.userId))}
                      className="text-xs font-bold cursor-pointer disabled:opacity-50 text-red-500"
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {group.myRole && group.myRole !== 'owner' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => leaveGroup(group.id), { left: true })}
            className="text-sm font-bold cursor-pointer disabled:opacity-50 text-red-500"
          >
            Sair do grupo
          </button>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">Encontros</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Só aparecem os encontros deste grupo em que você já tem acesso.
        </p>
        <CloudSessionCreateForm
          user={user}
          groupId={group.id}
          heading="Novo encontro neste grupo"
          onCreated={onOpenSession}
        />
        {sessionsLoading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Carregando encontros...
          </p>
        ) : null}
        {sessionsError ? (
          <p className="text-sm font-semibold text-red-500">{sessionsError}</p>
        ) : null}
        {!sessionsLoading && !sessionsError && sessions.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Você ainda não participa de um encontro deste grupo.
          </p>
        ) : null}
        {sessions.map((item) => (
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
        ))}
      </section>
      </>
      ) : null}

      {status ? (
        <p
          className={`text-sm ${status.startsWith('Não') || status.includes('não foi') ? 'font-semibold text-red-500' : ''}`}
          style={
            status.startsWith('Não') || status.includes('não foi')
              ? undefined
              : { color: 'var(--text-muted)' }
          }
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
