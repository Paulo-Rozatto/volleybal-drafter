import { useEffect, useState } from 'react';
import CompetitionDetail from './CompetitionDetail.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import CopyInviteButton from './ui/CopyInviteButton.jsx';
import {
  classifyCompetitionPersist,
  findChangedCompetitionMatch,
  teamsPayloadFromCompetition,
} from './cloudCompetitionPanel.js';
import {
  canManageCloudCompetition,
  canScoreCloudCompetition,
  competitionDocumentOf,
  competitionRoleLabel,
} from './supabase/competitionMappers.js';
import { cloudCompetitionJoinPath } from './supabase/joinCode.js';
import {
  finalizeCloudCompetition,
  removeCloudCompetitionMember,
  replaceCloudCompetitionTeams,
  rotateCloudCompetitionJoinCode,
  saveCloudCompetitionStructure,
  setCloudCompetitionMatchScore,
  setCloudCompetitionMemberRole,
} from './supabase/competitionApi.js';
import { createCloudPlayer, listLinkablePlayers } from './supabase/sessionApi.js';

function asRpcResult(rpc, fallback = 'Não foi possível concluir.') {
  if (rpc?.ok) return { ok: true, errors: [] };
  const error = rpc?.error ?? rpc?.errors?.[0];
  return {
    ok: false,
    errors: error
      ? [{ code: error.code, message: error.message || fallback }]
      : [{ code: 'CLOUD_ERROR', message: fallback }],
  };
}

export default function CloudCompetitionDetail({ loaded, user, onBack, onReload }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [guestName, setGuestName] = useState('');
  const [cloudPlayers, setCloudPlayers] = useState([]);
  const competition = loaded.competition;
  const role = loaded.myRole;
  const manage = canManageCloudCompetition(role);
  const canScore = canScoreCloudCompetition(role, competition.status);
  const joinHref = `${globalThis.location?.origin ?? ''}${import.meta.env.BASE_URL ?? '/'}${cloudCompetitionJoinPath(loaded.joinCode)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      const listed = await listLinkablePlayers(user.id);
      if (cancelled) return;
      if (listed.ok) setCloudPlayers(listed.players ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const rosterById = new Map();
  for (const player of [...cloudPlayers, ...(loaded.roster ?? [])]) {
    if (player?.id && !rosterById.has(player.id)) {
      rosterById.set(player.id, { id: player.id, name: player.name });
    }
  }
  const roster = [...rosterById.values()];

  async function persistDomain(operation) {
    const document = competitionDocumentOf(competition);
    const result = operation(document);
    if (!result?.ok) return result;

    const next = result.competition;
    const kind = classifyCompetitionPersist(competition, next);
    let rpc;
    if (kind === 'teams') {
      rpc = await replaceCloudCompetitionTeams(
        competition.id,
        loaded.structureVersion,
        teamsPayloadFromCompetition(next)
      );
    } else if (kind === 'structure') {
      rpc = await saveCloudCompetitionStructure(
        competition.id,
        loaded.structureVersion,
        next
      );
    } else {
      const match = findChangedCompetitionMatch(competition, next);
      rpc = await setCloudCompetitionMatchScore({
        competitionId: competition.id,
        matchId: match?.id,
        scoreA: match?.scoreA ?? null,
        scoreB: match?.scoreB ?? null,
        playedDate: match?.playedDate ?? null,
        expectedVersion: loaded.matchVersions?.[match?.id] ?? 0,
        expectedStructureVersion: loaded.structureVersion,
        documentCompetition: next,
      });
    }

    const mapped = asRpcResult(rpc);
    if (mapped.ok) {
      setStatus('');
      await onReload?.();
    } else {
      setStatus(mapped.errors[0]?.message || 'Não foi possível salvar a competição.');
    }
    return mapped;
  }

  async function run(action) {
    setBusy(true);
    setStatus('');
    try {
      const result = await action();
      if (!result.ok) {
        setStatus(result.error?.message || 'Não foi possível concluir a operação.');
        return;
      }
      await onReload?.();
    } catch (error) {
      setStatus(error?.message || 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  async function addGuest(event) {
    event.preventDefault();
    const name = guestName.trim();
    if (!name || !manage) return;
    setBusy(true);
    setStatus('');
    const created = await createCloudPlayer({ name, createdBy: user.id });
    setBusy(false);
    if (!created.ok) {
      setStatus(created.error?.message || 'Não foi possível criar o jogador.');
      return;
    }
    setCloudPlayers((current) => [...current, created.player]);
    setGuestName('');
  }

  return (
    <div className="space-y-4">
      <CompetitionDetail
        competition={competition}
        players={roster}
        canEditTeams={manage}
        canScore={canScore}
        onBack={onBack}
        onApplyOperation={(operation) => persistDomain(operation)}
        headerExtra={
          <div className="space-y-1 pt-2">
            {loaded.groupId ? (
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Associada a um grupo
              </p>
            ) : (
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Competição avulsa
              </p>
            )}
            {loaded.legacySourceId ? (
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Importado do legado
              </p>
            ) : null}
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              Seu papel: {competitionRoleLabel(role)}
            </p>
          </div>
        }
      />

      <section
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <p className="text-sm font-semibold">Convite: {loaded.joinCode}</p>
        <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>
          {joinHref}
        </p>
        <div className="flex flex-wrap gap-2">
        <CopyInviteButton href={joinHref} code={loaded.joinCode} />
          {manage ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => rotateCloudCompetitionJoinCode(competition.id))}
              className="font-bold py-2 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
            >
              Gerar novo código
            </button>
          ) : null}
        </div>
      </section>

      <section
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">Acesso</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Quem entra com o convite colabora nesta competição. Isso não coloca ninguém no elenco nem no grupo.
        </p>
        {loaded.members.map((member) => {
          const canEditMember = manage && member.role !== 'owner' && member.userId !== user?.id;
          return (
            <div key={member.userId} className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {member.displayName || member.userId} · {competitionRoleLabel(member.role)}
              </p>
              {canEditMember ? (
                <div className="flex flex-wrap gap-2">
                  {member.role === 'member' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => setCloudCompetitionMemberRole(competition.id, member.userId, 'admin'))
                      }
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
                      onClick={() =>
                        run(() => setCloudCompetitionMemberRole(competition.id, member.userId, 'member'))
                      }
                      className="text-xs font-bold cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--primary)' }}
                    >
                      Rebaixar a membro
                    </button>
                  ) : null}
                  {member.role !== 'viewer' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => setCloudCompetitionMemberRole(competition.id, member.userId, 'viewer'))
                      }
                      className="text-xs font-bold cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--primary)' }}
                    >
                      Tornar visualizador
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingRemove(member)}
                    className="text-xs font-bold cursor-pointer disabled:opacity-50 text-red-500"
                  >
                    Remover
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {manage && competition.status === 'draft' ? (
        <form
          className="p-4 rounded-xl border space-y-2"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          onSubmit={addGuest}
        >
          <h3 className="font-bold text-sm">Convidado no elenco</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Cria um jogador cloud. Não vira competition_member nem group_member.
          </p>
          <input
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Nome do convidado"
            className="w-full border p-2 rounded text-sm outline-none"
            style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
          />
          <button
            type="submit"
            disabled={busy || !guestName.trim()}
            className="font-bold py-2 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            Criar jogador
          </button>
        </form>
      ) : null}

      {manage && competition.status === 'in_progress' ? (
        <button
          type="button"
          disabled={busy}
            onClick={() => setConfirmFinalize(true)}
          className="w-full font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          Finalizar competição
        </button>
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
      {confirmFinalize ? (
        <ConfirmDialog
          titleId="finalize-competition-title"
          title="Finalizar competição?"
          message="A competição deixa de aceitar mudanças de chave. Placar ainda pode ser corrigido por dono ou administrador."
          confirmLabel="Finalizar competição"
          onConfirm={() => {
            setConfirmFinalize(false);
            run(() => finalizeCloudCompetition(competition.id, loaded.structureVersion));
          }}
          onCancel={() => setConfirmFinalize(false)}
        />
      ) : null}
      {pendingRemove ? (
        <ConfirmDialog
          titleId="remove-competition-member-title"
          title="Remover acesso?"
          message={`Remover ${pendingRemove.displayName || 'esta pessoa'} desta competição?`}
          confirmLabel="Remover"
          destructive
          onConfirm={() => {
            const member = pendingRemove;
            setPendingRemove(null);
            run(() => removeCloudCompetitionMember(competition.id, member.userId));
          }}
          onCancel={() => setPendingRemove(null)}
        />
      ) : null}
    </div>
  );
}
