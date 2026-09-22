import { useState } from 'react';
import CloudGroupRanking from './CloudGroupRanking.jsx';
import CloudSessionCreateForm from './CloudSessionCreateForm.jsx';
import CloudCompetitionCreateForm from './CloudCompetitionCreateForm.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
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
  updateGroupTimezone,
} from './supabase/groupApi.js';
import CopyInviteButton from './ui/CopyInviteButton.jsx';
import EmptyState from './ui/EmptyState.jsx';
import EntityCard from './ui/EntityCard.jsx';
import ErrorState from './ui/ErrorState.jsx';
import LoadingState from './ui/LoadingState.jsx';
import Tabs from './ui/Tabs.jsx';
import GroupChatPanel from './community/GroupChatPanel.jsx';
import { isCommunityBetaEnabled } from './community/flags.js';
import { formatSessionDate } from './teamGameSessions.js';
import GroupScheduleView from './schedule/GroupScheduleView.jsx';
import { COMMON_GROUP_TIMEZONES } from './domain/groupAvailability.js';

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
  initialSection,
  openProposalId,
  onSectionChange,
  onOpenProposal,
}) {
  if (groupLoading) {
    return <LoadingState label="Carregando grupo..." />;
  }

  if (groupError || !group) {
    return (
      <ErrorState
        message={groupError || 'Não foi possível abrir o grupo.'}
        onBack={onBack}
        backLabel="← Grupos"
        onRetry={onRetry}
      />
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
      initialSection={initialSection}
      openProposalId={openProposalId}
      onSectionChange={onSectionChange}
      onOpenProposal={onOpenProposal}
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
  initialSection,
  openProposalId,
  onSectionChange,
  onOpenProposal,
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState(initialSection || 'grupo');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingTimezone, setPendingTimezone] = useState(null);
  const [rankingUserId, setRankingUserId] = useState(null);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [timezone, setTimezone] = useState(group.timezone || 'America/Sao_Paulo');
  const manage = canManageGroup(group.myRole);
  const communityBeta = isCommunityBetaEnabled();

  function changeSection(next) {
    setSection(next);
    onSectionChange?.(next);
  }
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

      <Tabs
        label="Seções do grupo"
        value={section}
        onChange={changeSection}
        options={[
          { id: 'grupo', label: 'Visão geral' },
          { id: 'encontros', label: 'Encontros' },
          { id: 'competicoes', label: 'Competições' },
          { id: 'ranking', label: 'Ranking' },
          { id: 'membros', label: 'Membros' },
          ...(communityBeta ? [{ id: 'chat', label: 'Chat' }] : []),
          ...(communityBeta ? [{ id: 'disponibilidade', label: 'Disponibilidade' }] : []),
        ]}
      />

      {section === 'ranking' ? (
        <CloudGroupRanking
          key={group.id}
          groupId={group.id}
          groupName={group.name}
          selectedUserId={rankingUserId}
          onSelectUser={setRankingUserId}
        />
      ) : null}

      {section === 'chat' && communityBeta ? (
        <GroupChatPanel group={group} user={user} />
      ) : null}

      {section === 'disponibilidade' && communityBeta ? (
        <GroupScheduleView
          group={group}
          user={user}
          openProposalId={openProposalId}
          onOpenProposal={onOpenProposal}
          onOpenSession={onOpenSession}
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
          <EmptyState
            title="Nenhuma competição neste grupo"
            description="Você ainda não participa de uma competição deste grupo."
          />
        ) : null}
        {competitions.map((item) => (
          <EntityCard
            key={item.id}
            title={item.name || 'Competição'}
            dateLabel={formatSessionDate(item.date)}
            status={item.status}
            onClick={() => onOpenCompetition?.(item.id)}
          />
        ))}
        </section>
      ) : null}

      {['grupo', 'encontros', 'membros'].includes(section) ? (
      <>
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
                if (!result.ok) return result;
                if (timezone !== (group.timezone || 'America/Sao_Paulo')) {
                  setPendingTimezone(timezone);
                  setEditing(false);
                  return result;
                }
                setEditing(false);
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
            <label className="block text-sm font-semibold">
              Fuso do grupo
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="mt-1 w-full border p-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-main)',
                  borderColor: 'var(--border-color)',
                }}
              >
                {COMMON_GROUP_TIMEZONES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
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
                  setTimezone(group.timezone || 'America/Sao_Paulo');
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
              {memberCountLabel(group.memberCount)} · seu papel: {groupRoleLabel(group.myRole)} · fuso{' '}
              {group.timezone || 'America/Sao_Paulo'}
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
          <CopyInviteButton href={joinHref} code={group.joinCode} />
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
      </>
      ) : null}

      {(section === 'grupo' || section === 'membros') ? (
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
                  changeSection('ranking');
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
                      onClick={() => setPendingRemove(member)}
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
            onClick={() => setConfirmLeave(true)}
            className="text-sm font-bold cursor-pointer disabled:opacity-50 text-red-500"
          >
            Sair do grupo
          </button>
        ) : null}
      </section>
      ) : null}

      {(section === 'grupo' || section === 'encontros') ? (
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
          <EmptyState
            title="Nenhum encontro neste grupo"
            description="Você ainda não participa de um encontro deste grupo."
          />
        ) : null}
        {sessions.map((item) => (
          <EntityCard
            key={item.id}
            title={item.name || 'Encontro'}
            dateLabel={formatSessionDate(item.date)}
            status={item.status}
            onClick={() => onOpenSession?.(item.id)}
          />
        ))}
      </section>
      ) : null}
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
      {confirmLeave ? (
        <ConfirmDialog
          titleId="leave-group-title"
          title="Sair do grupo?"
          message="Você deixa de fazer parte desta turma. Encontros e competições em que já entrou continuam visíveis."
          confirmLabel="Sair do grupo"
          destructive
          onConfirm={() => {
            setConfirmLeave(false);
            run(() => leaveGroup(group.id), { left: true });
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      ) : null}
      {pendingTimezone ? (
        <ConfirmDialog
          titleId="group-timezone-title"
          title="Alterar fuso do grupo?"
          message="Os horários existentes serão exibidos no novo fuso. Os timestamps gravados não mudam."
          confirmLabel="Alterar fuso"
          onConfirm={() => {
            const next = pendingTimezone;
            setPendingTimezone(null);
            run(() => updateGroupTimezone(group.id, next));
          }}
          onCancel={() => {
            setPendingTimezone(null);
            setTimezone(group.timezone || 'America/Sao_Paulo');
          }}
        />
      ) : null}
      {pendingRemove ? (
        <ConfirmDialog
          titleId="remove-group-member-title"
          title="Remover membro?"
          message={`Remover ${pendingRemove.displayName || 'esta pessoa'} do grupo? Isso não tira o acesso de encontros ou competições já existentes.`}
          confirmLabel="Remover"
          destructive
          onConfirm={() => {
            const member = pendingRemove;
            setPendingRemove(null);
            run(() => removeGroupMember(group.id, member.userId));
          }}
          onCancel={() => setPendingRemove(null)}
        />
      ) : null}
    </div>
  );
}
