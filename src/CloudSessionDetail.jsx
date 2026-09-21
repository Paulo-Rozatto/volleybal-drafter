import React, { useState } from 'react';
import AutomaticTeamBuilder from './AutomaticTeamBuilder.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import RoundBoard from './RoundBoard.jsx';
import TeamBuilder from './TeamBuilder.jsx';
import {
  cloudSessionToDocument,
  lineupPlan,
  roundsPlanFromSession,
  teamsPlanFromSession,
} from './supabase/cloudSessionDocument.js';
import { cloudJoinPath } from './supabase/joinCode.js';
import {
  addCloudSessionPlayer,
  applyCloudSessionRounds,
  createCloudPlayer,
  finalizeCloudSession,
  removeCloudSessionPlayer,
  replaceCloudSessionTeams,
  resetCloudSessionToDraft,
  rotateCloudJoinCode,
  setCloudMatchLineups,
  setCloudMatchScore,
} from './supabase/sessionApi.js';
import { generateRoundsBlockedReason } from './teamFormationUi.js';
import {
  alterTeamsLabel,
  drawTeamsLabel,
  FINALIZE_SCORES_REQUIRED_MESSAGE,
  FINALIZE_SESSION_HEADING,
  FINALIZE_SESSION_READY_MESSAGE,
  formatFormatLabel,
  formatTeamCountPhrase,
  generateRoundsConfirmationMessage,
  resetToDraftConfirmationMessage,
  resolveTeamSize,
  teamUnitNoun,
} from './teamPresentation.js';
import {
  addSessionTeam,
  APPEND_ROUND_ROBIN_CYCLE_CONFIRMATION_MESSAGE,
  appendTeamSessionRoundRobinCycle,
  canAppendTeamSessionRoundRobinCycle,
  canClearSessionScores,
  canEditSessionTeams,
  canEnableFinalizeTeamSession,
  canGenerateTeamSessionRounds,
  CLEAR_SCORE_CONFIRMATION_MESSAGE,
  FINALIZE_TEAM_SESSION_CONFIRMATION_MESSAGE,
  finalizeTeamSession,
  formatSessionDate,
  removeSessionTeam,
  replaceSessionTeams,
  resetTeamSessionToDraftForTeamEditing,
  sessionDisplayName,
  sessionListStats,
  setTeamSessionMatchLineups,
  startTeamSessionRoundRobin,
  teamSessionFinalizeProgressLabel,
  teamSessionRoundSummary,
  translateSessionStatus,
  updateSessionTeam,
} from './teamGameSessions.js';

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function canManage(role) {
  return role === 'owner' || role === 'admin';
}

function canEditScores(role, session) {
  if (role === 'owner' || role === 'admin') {
    return session?.status === 'in_progress' || session?.status === 'finished';
  }
  if (role === 'member') return session?.status === 'in_progress';
  return false;
}

function canClearScores(role, session) {
  return canManage(role) && canClearSessionScores(session);
}

function asRpcResult(rpc) {
  if (rpc?.ok) return { ok: true, errors: [] };
  const error = rpc?.error ?? rpc?.errors?.[0];
  return { ok: false, errors: error ? [error] : [{ code: 'CLOUD_ERROR', message: 'Não foi possível concluir.' }] };
}

function latestCycleNumber(session) {
  return (session?.rounds ?? []).reduce(
    (max, round) => Math.max(max, round.cycleNumber ?? 1),
    1
  );
}

function findMatch(session, matchId) {
  for (const round of session?.rounds ?? []) {
    const match = (round.matches ?? []).find((item) => item.id === matchId);
    if (match) return match;
  }
  return null;
}

function roleLabel(role) {
  if (role === 'owner') return 'organizador';
  if (role === 'admin') return 'admin';
  if (role === 'member') return 'membro';
  if (role === 'viewer') return 'visitante';
  return role ?? '';
}

export default function CloudSessionDetail({ session, user, onReload }) {
  const [teamMode, setTeamMode] = useState('manual');
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmAppendCycle, setConfirmAppendCycle] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [courtCount, setCourtCount] = useState(2);
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewSessionId, setViewSessionId] = useState(session?.id);

  if (session?.id !== viewSessionId) {
    setViewSessionId(session?.id);
    setCourtCount(Number.isInteger(session?.courtCount) ? session.courtCount : 2);
    setActionError(null);
  }

  const role = session.myRole;
  const manage = canManage(role);
  const roster = session.players ?? [];
  const document = cloudSessionToDocument(session);
  const teamSize = resolveTeamSize(session);
  const units = teamUnitNoun(teamSize, 2);
  const { teamCount } = sessionListStats(session);
  const formatTeamCount = session?.format?.teamCount ?? teamCount;
  const { roundCount, matchCount, completedCount, pendingCount, invalidCount } =
    teamSessionRoundSummary(session);
  const editable = manage && canEditSessionTeams(session);
  const mode = editable ? teamMode : 'manual';
  const canGenerate = manage && canGenerateTeamSessionRounds(session, roster);
  const canAppendCycle = manage && canAppendTeamSessionRoundRobinCycle(session);
  const generateBlockedReason = editable && !canGenerate ? generateRoundsBlockedReason(session) : null;
  const inProgress = session?.status === 'in_progress';
  const finished = session?.status === 'finished';
  const canFinalize = manage && canEnableFinalizeTeamSession(session);
  const finalizeProgressLabel = teamSessionFinalizeProgressLabel(session);
  const maxCourts = Math.max(1, Math.floor(Math.max(formatTeamCount, 2) / 2));
  const selectedCourtCount = Math.min(Math.max(courtCount, 1), maxCourts);
  const joinHref = `${globalThis.location?.origin ?? ''}${import.meta.env.BASE_URL ?? '/'}${cloudJoinPath(session.joinCode)}`;

  async function persistOk(rpc) {
    const result = asRpcResult(await rpc);
    if (result.ok) {
      setConfirmGenerate(false);
      setConfirmReset(false);
      setConfirmFinalize(false);
      setConfirmAppendCycle(false);
      setActionError(null);
      await onReload?.();
    } else if (result.errors[0]?.message) {
      setActionError(result.errors[0].message);
    }
    return result;
  }

  async function runDomainThen(domainResult, persist) {
    if (!domainResult?.ok) {
      const code = domainResult?.errors?.[0]?.code;
      if (code === 'GENERATE_ROUNDS_CONFIRMATION_REQUIRED') {
        setConfirmGenerate(true);
        setActionError(null);
        return domainResult;
      }
      if (code === 'RESET_TO_DRAFT_CONFIRMATION_REQUIRED') {
        setConfirmReset(true);
        setActionError(null);
        return domainResult;
      }
      if (code === 'FINALIZE_CONFIRMATION_REQUIRED') {
        setConfirmFinalize(true);
        setActionError(null);
        return domainResult;
      }
      if (code === 'APPEND_CYCLE_CONFIRMATION_REQUIRED') {
        setConfirmAppendCycle(true);
        setActionError(null);
        return domainResult;
      }
      if (domainResult?.errors?.[0]?.message) setActionError(domainResult.errors[0].message);
      return domainResult;
    }
    return persist(domainResult);
  }

  async function persistTeams(domainResult) {
    return persistOk(
      await replaceCloudSessionTeams(
        session.id,
        teamsPlanFromSession(domainResult.session),
        session.structureVersion
      )
    );
  }

  const requestGenerateRounds = () =>
    runDomainThen(
      startTeamSessionRoundRobin(document, session.id, {
        roster,
        courtCount: selectedCourtCount,
        generateConfirmed: false,
      }),
      persistGeneratedRounds
    );

  const confirmGenerateRounds = () =>
    runDomainThen(
      startTeamSessionRoundRobin(document, session.id, {
        roster,
        courtCount: selectedCourtCount,
        generateConfirmed: true,
      }),
      persistGeneratedRounds
    );

  async function persistGeneratedRounds(domainResult) {
    return persistOk(
      await applyCloudSessionRounds(
        session.id,
        'replace',
        roundsPlanFromSession(domainResult.session),
        session.structureVersion,
        selectedCourtCount
      )
    );
  }

  const requestAppendCycle = () =>
    runDomainThen(
      appendTeamSessionRoundRobinCycle(document, session.id, {
        roster,
        courtCount: session.courtCount ?? selectedCourtCount,
        appendConfirmed: false,
      }),
      persistAppendedRounds
    );

  const confirmAppendCycleAction = () =>
    runDomainThen(
      appendTeamSessionRoundRobinCycle(document, session.id, {
        roster,
        courtCount: session.courtCount ?? selectedCourtCount,
        appendConfirmed: true,
      }),
      persistAppendedRounds
    );

  async function persistAppendedRounds(domainResult) {
    const cycleNumber = latestCycleNumber(domainResult.session);
    return persistOk(
      await applyCloudSessionRounds(
        session.id,
        'append',
        roundsPlanFromSession(domainResult.session, { cycleNumber }),
        session.structureVersion,
        session.courtCount ?? selectedCourtCount
      )
    );
  }

  const requestResetToDraft = () =>
    runDomainThen(
      resetTeamSessionToDraftForTeamEditing(document, session.id, { resetConfirmed: false }),
      persistReset
    );

  const confirmResetToDraft = () =>
    runDomainThen(
      resetTeamSessionToDraftForTeamEditing(document, session.id, { resetConfirmed: true }),
      persistReset
    );

  async function persistReset() {
    return persistOk(await resetCloudSessionToDraft(session.id, session.structureVersion));
  }

  const requestFinalize = () =>
    runDomainThen(
      finalizeTeamSession(document, session.id, { finalizeConfirmed: false }),
      persistFinalize
    );

  const confirmFinalizeSession = () =>
    runDomainThen(
      finalizeTeamSession(document, session.id, { finalizeConfirmed: true }),
      persistFinalize
    );

  async function persistFinalize() {
    return persistOk(await finalizeCloudSession(session.id, session.structureVersion));
  }

  async function addGuestPlayer(event) {
    event.preventDefault();
    const name = guestName.trim();
    if (!name || !manage || !editable) return;
    setBusy(true);
    setActionError(null);
    const created = await createCloudPlayer({ name, createdBy: user.id });
    if (!created.ok) {
      setBusy(false);
      setActionError(created.error?.message || 'Não foi possível criar o jogador.');
      return;
    }
    const added = await addCloudSessionPlayer(
      session.id,
      created.player.id,
      created.player.name,
      session.structureVersion
    );
    setBusy(false);
    if (!added.ok) {
      setActionError(added.error?.message || 'Não foi possível incluir o jogador.');
      return;
    }
    setGuestName('');
    await onReload?.();
  }

  async function removePlayer(playerId) {
    setBusy(true);
    const removed = await removeCloudSessionPlayer(session.id, playerId, session.structureVersion);
    setBusy(false);
    await persistOk(removed);
  }

  const teamIdsWithPlayer = new Set(
    (session.teams ?? []).flatMap((team) => (team.members ?? []).map((member) => member.playerId))
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{sessionDisplayName(session)}</h2>
      <div
        className="p-4 rounded-xl border space-y-1"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatSessionDate(session.date)}
        </p>
        <p className="text-sm font-semibold">{translateSessionStatus(session.status)}</p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          Formato {formatFormatLabel(teamSize)} · seu papel: {roleLabel(role)}
        </p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {formatTeamCountPhrase(teamCount, teamSize)}
        </p>
        {Number.isInteger(session?.courtCount) && (
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {pluralize(session.courtCount, 'quadra', 'quadras')}
          </p>
        )}
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {pluralize(roundCount, 'rodada', 'rodadas')} · {pluralize(matchCount, 'partida', 'partidas')}
        </p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {pluralize(completedCount, 'partida concluída', 'partidas concluídas')} ·{' '}
          {pluralize(pendingCount, 'partida pendente', 'partidas pendentes')}
          {invalidCount > 0
            ? ` · ${pluralize(invalidCount, 'partida inválida', 'partidas inválidas')}`
            : ''}
        </p>
      </div>

      {manage ? (
        <div
          className="p-4 rounded-xl border space-y-2"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <p className="text-sm font-semibold">Convite: {session.joinCode}</p>
          <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>
            {joinHref}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => persistOk(rotateCloudJoinCode(session.id))}
            className="font-bold py-2 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
          >
            Trocar código
          </button>
        </div>
      ) : null}

      <section
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">Acesso</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Quem entra com o código participa do encontro. Isso não vincula a conta a um jogador.
        </p>
        {(session.members ?? []).map((member) => (
          <p key={member.userId} className="text-sm">
            {member.displayName || member.userId} · {roleLabel(member.role)}
          </p>
        ))}
      </section>

      <section
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">Jogadores do encontro</h3>
        {roster.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nenhum jogador neste encontro.
          </p>
        ) : (
          roster.map((player) => (
            <div key={player.playerId} className="flex items-center justify-between gap-2">
              <p className="text-sm">
                {player.playerName}
                {player.linkedUserId ? ' · conta vinculada' : ''}
              </p>
              {editable && !teamIdsWithPlayer.has(player.playerId) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removePlayer(player.playerId)}
                  className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                >
                  Remover
                </button>
              ) : null}
            </div>
          ))
        )}
        {editable ? (
          <form className="flex gap-2" onSubmit={addGuestPlayer}>
            <input
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Nome do jogador"
              className="flex-1 border p-2 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />
            <button
              type="submit"
              disabled={busy || !guestName.trim()}
              className="font-bold px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Incluir
            </button>
          </form>
        ) : null}
      </section>

      {inProgress && canFinalize && (
        <div
          className="p-4 rounded-xl border"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--primary)' }}
        >
          <p className="text-sm font-bold">{FINALIZE_SESSION_READY_MESSAGE}</p>
        </div>
      )}

      {finished && (
        <div
          className="p-4 rounded-xl border"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
        >
          <p className="text-sm font-bold">{FINALIZE_SESSION_HEADING}</p>
        </div>
      )}

      {editable && (
        <div className="flex rounded-lg p-1 gap-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <button
            type="button"
            onClick={() => setTeamMode('manual')}
            className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
            style={{
              backgroundColor: mode === 'manual' ? 'var(--primary)' : 'transparent',
              color: mode === 'manual' ? 'var(--text-inverse)' : 'var(--text-muted)',
            }}
          >
            Montar manualmente
          </button>
          <button
            type="button"
            onClick={() => setTeamMode('auto')}
            className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
            style={{
              backgroundColor: mode === 'auto' ? 'var(--primary)' : 'transparent',
              color: mode === 'auto' ? 'var(--text-inverse)' : 'var(--text-muted)',
            }}
          >
            {drawTeamsLabel(teamSize)}
          </button>
        </div>
      )}

      {mode === 'auto' && (
        <AutomaticTeamBuilder
          key={session.updatedAt}
          session={session}
          roster={roster}
          onReplaceTeams={(teams, { replaceConfirmed } = {}) =>
            runDomainThen(
              replaceSessionTeams(document, session.id, teams, {
                roster,
                replaceConfirmed,
              }),
              persistTeams
            )
          }
        />
      )}

      <TeamBuilder
        session={session}
        roster={roster}
        showForm={mode === 'manual'}
        onRequestEdit={() => setTeamMode('manual')}
        onAddTeam={(memberIds) =>
          runDomainThen(addSessionTeam(document, session.id, memberIds, { roster }), persistTeams)
        }
        onUpdateTeam={(teamId, memberIds) =>
          runDomainThen(
            updateSessionTeam(document, session.id, teamId, memberIds, { roster }),
            persistTeams
          )
        }
        onRemoveTeam={(teamId) =>
          runDomainThen(removeSessionTeam(document, session.id, teamId, { roster }), persistTeams)
        }
      />

      {editable && (
        <div className="space-y-2">
          {generateBlockedReason && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {generateBlockedReason}
            </p>
          )}
          {actionError && !confirmGenerate && (
            <p className="text-xs font-semibold text-red-500">{actionError}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Número de quadras</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCourtCount((current) => Math.max(1, current - 1))}
                disabled={selectedCourtCount <= 1}
                className="w-10 h-10 font-bold rounded-lg border cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-main)',
                }}
              >
                -
              </button>
              <span className="w-8 text-center font-bold">{selectedCourtCount}</span>
              <button
                type="button"
                onClick={() => setCourtCount((current) => Math.min(maxCourts, current + 1))}
                disabled={selectedCourtCount >= maxCourts}
                className="w-10 h-10 font-bold rounded-lg border cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-main)',
                }}
              >
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={requestGenerateRounds}
            disabled={!canGenerate}
            className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            Gerar rodadas
          </button>
        </div>
      )}

      {actionError && !editable && !confirmReset && !confirmFinalize && !confirmAppendCycle && (
        <p className="text-xs font-semibold text-red-500">{actionError}</p>
      )}

      <RoundBoard
        session={session}
        roster={roster}
        canEditScores={canEditScores(role, session)}
        canClearScores={canClearScores(role, session)}
        canEditLineups={manage && inProgress}
        onSaveScore={async (_roundId, matchId, scoreA, scoreB, options = {}) => {
          if (options.useCurrent) {
            await onReload?.();
            return { ok: true, errors: [] };
          }
          const match = findMatch(session, matchId);
          const result = await setCloudMatchScore(
            matchId,
            scoreA,
            scoreB,
            options.expectedVersion ?? match?.version ?? 0
          );
          if (result.ok) await onReload?.();
          return result;
        }}
        onClearScore={async (_roundId, matchId, { clearConfirmed } = {}) => {
          if (!clearConfirmed) {
            return {
              ok: false,
              errors: [
                {
                  code: 'CLEAR_SCORE_CONFIRMATION_REQUIRED',
                  message: CLEAR_SCORE_CONFIRMATION_MESSAGE,
                },
              ],
            };
          }
          const match = findMatch(session, matchId);
          const result = await setCloudMatchScore(matchId, null, null, match?.version ?? 0);
          if (result.ok) await onReload?.();
          return result;
        }}
        onSaveLineups={async (roundId, matchId, lineupAPlayerIds, lineupBPlayerIds) => {
          const domainResult = setTeamSessionMatchLineups(
            document,
            session.id,
            roundId,
            matchId,
            lineupAPlayerIds,
            lineupBPlayerIds,
            { roster }
          );
          if (!domainResult.ok) {
            setActionError(domainResult.errors[0]?.message || 'Não foi possível salvar as escalações.');
            return domainResult;
          }
          const match = findMatch(domainResult.session, matchId);
          const result = await persistOk(
            await setCloudMatchLineups(
              matchId,
              lineupPlan(match?.lineupA),
              lineupPlan(match?.lineupB),
              session.structureVersion
            )
          );
          return result;
        }}
      />

      {inProgress && manage && (
        <div className="space-y-2">
          {!canFinalize && (
            <>
              <p className="text-sm font-semibold">{finalizeProgressLabel}</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {FINALIZE_SCORES_REQUIRED_MESSAGE}
              </p>
            </>
          )}
          {canAppendCycle && (
            <button
              type="button"
              onClick={requestAppendCycle}
              className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Gerar nova sequência
            </button>
          )}
          <button
            type="button"
            onClick={requestFinalize}
            disabled={!canFinalize}
            className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            Finalizar encontro
          </button>
          <button
            type="button"
            onClick={requestResetToDraft}
            className="w-full font-bold py-3 rounded-xl border cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
          >
            {alterTeamsLabel(teamSize)}
          </button>
        </div>
      )}

      {(session.matchEvents ?? []).length > 0 && (
        <section
          className="p-4 rounded-xl border space-y-2"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <h3 className="font-bold text-sm">Histórico de placar</h3>
          {session.matchEvents.slice(0, 20).map((event) => (
            <p key={event.id} className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {event.eventType === 'clear_score' ? 'Limpou' : 'Alterou'} {event.oldScoreA ?? '—'}×
              {event.oldScoreB ?? '—'} → {event.newScoreA ?? '—'}×{event.newScoreB ?? '—'} · v
              {event.versionBefore}→{event.versionAfter}
            </p>
          ))}
        </section>
      )}

      {confirmGenerate && (
        <ConfirmDialog
          titleId="cloud-generate-rounds-title"
          title="Gerar rodadas"
          message={generateRoundsConfirmationMessage(teamSize)}
          confirmLabel="Gerar rodadas"
          onConfirm={confirmGenerateRounds}
          onCancel={() => setConfirmGenerate(false)}
        />
      )}

      {confirmAppendCycle && (
        <ConfirmDialog
          titleId="cloud-append-cycle-title"
          title="Gerar nova sequência"
          message={APPEND_ROUND_ROBIN_CYCLE_CONFIRMATION_MESSAGE}
          confirmLabel="Gerar nova sequência"
          onConfirm={confirmAppendCycleAction}
          onCancel={() => setConfirmAppendCycle(false)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          titleId="cloud-reset-draft-title"
          title={alterTeamsLabel(teamSize)}
          message={resetToDraftConfirmationMessage(teamSize)}
          confirmLabel={`Apagar rodadas e alterar ${units}`}
          onConfirm={confirmResetToDraft}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {confirmFinalize && (
        <ConfirmDialog
          titleId="cloud-finalize-session-title"
          title="Finalizar este encontro?"
          message={FINALIZE_TEAM_SESSION_CONFIRMATION_MESSAGE}
          confirmLabel="Finalizar encontro"
          onConfirm={confirmFinalizeSession}
          onCancel={() => setConfirmFinalize(false)}
        />
      )}
    </div>
  );
}
