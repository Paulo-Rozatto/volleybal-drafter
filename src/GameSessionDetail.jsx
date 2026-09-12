import React, { useEffect, useState } from 'react';
import AutomaticTeamBuilder from './AutomaticTeamBuilder.jsx';
import TeamBuilder from './TeamBuilder.jsx';
import RoundBoard from './RoundBoard.jsx';
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
  canEditSessionTeams,
  canEnableFinalizeTeamSession,
  canGenerateTeamSessionRounds,
  clearTeamSessionMatchScore,
  FINALIZE_TEAM_SESSION_CONFIRMATION_MESSAGE,
  finalizeTeamSession,
  formatSessionDate,
  removeSessionTeam,
  replaceSessionTeams,
  resetTeamSessionToDraftForTeamEditing,
  sessionDisplayName,
  sessionListStats,
  setTeamSessionMatchScore,
  startTeamSessionRoundRobin,
  teamSessionFinalizeProgressLabel,
  teamSessionRoundSummary,
  translateSessionStatus,
  updateSessionTeam,
  setTeamSessionMatchLineups,
} from './teamGameSessions.js';

function ConfirmDialog({ titleId, title, message, confirmLabel, onConfirm, onCancel }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-main)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="font-bold text-base">
          {title}
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {message}
        </p>
        <button
          type="button"
          onClick={onConfirm}
          className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full font-bold py-3 rounded-xl border cursor-pointer"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-main)',
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function GameSessionDetail({
  session,
  sessionsDocument,
  players = [],
  syncPanel,
  onBack,
  onApplyDocument,
}) {
  const [teamMode, setTeamMode] = useState('manual');
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [actionError, setActionError] = useState(null);

  const teamSize = resolveTeamSize(session);
  const units = teamUnitNoun(teamSize, 2);
  const { teamCount } = sessionListStats(session);
  const { roundCount, matchCount, completedCount, pendingCount, invalidCount } =
    teamSessionRoundSummary(session);
  const editable = canEditSessionTeams(session);
  const mode = editable ? teamMode : 'manual';
  const canGenerate = canGenerateTeamSessionRounds(session, players);
  const generateBlockedReason = editable && !canGenerate ? generateRoundsBlockedReason(session) : null;
  const inProgress = session?.status === 'in_progress';
  const finished = session?.status === 'finished';
  const canFinalize = canEnableFinalizeTeamSession(session);
  const finalizeProgressLabel = teamSessionFinalizeProgressLabel(session);

  const persistIfOk = (result) => {
    if (result?.ok) {
      onApplyDocument?.(result.document);
      setConfirmGenerate(false);
      setConfirmReset(false);
      setConfirmFinalize(false);
      setActionError(null);
    }
    return result;
  };

  const applyTeamChange = (result) => persistIfOk(result);

  const applyRoundAction = (result) => {
    if (result?.ok) return persistIfOk(result);
    if (result?.errors?.[0]?.message) setActionError(result.errors[0].message);
    return result;
  };

  const requestGenerateRounds = () => {
    const result = startTeamSessionRoundRobin(sessionsDocument, session.id, {
      roster: players,
      generateConfirmed: false,
    });
    if (result?.errors?.[0]?.code === 'GENERATE_ROUNDS_CONFIRMATION_REQUIRED') {
      setConfirmGenerate(true);
      setActionError(null);
      return;
    }
    applyRoundAction(result);
  };

  const confirmGenerateRounds = () => {
    applyRoundAction(
      startTeamSessionRoundRobin(sessionsDocument, session.id, {
        roster: players,
        generateConfirmed: true,
      })
    );
  };

  const requestResetToDraft = () => {
    const result = resetTeamSessionToDraftForTeamEditing(sessionsDocument, session.id, {
      resetConfirmed: false,
    });
    if (result?.errors?.[0]?.code === 'RESET_TO_DRAFT_CONFIRMATION_REQUIRED') {
      setConfirmReset(true);
      setActionError(null);
      return;
    }
    applyRoundAction(result);
  };

  const confirmResetToDraft = () => {
    applyRoundAction(
      resetTeamSessionToDraftForTeamEditing(sessionsDocument, session.id, {
        resetConfirmed: true,
      })
    );
  };

  const requestFinalize = () => {
    const result = finalizeTeamSession(sessionsDocument, session.id, {
      finalizeConfirmed: false,
    });
    if (result?.errors?.[0]?.code === 'FINALIZE_CONFIRMATION_REQUIRED') {
      setConfirmFinalize(true);
      setActionError(null);
      return;
    }
    applyRoundAction(result);
  };

  const confirmFinalizeSession = () => {
    applyRoundAction(
      finalizeTeamSession(sessionsDocument, session.id, {
        finalizeConfirmed: true,
      })
    );
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="font-bold text-sm py-2 cursor-pointer"
        style={{ color: 'var(--primary)' }}
      >
        ← Voltar para encontros
      </button>

      <h2 className="text-xl font-bold">{sessionDisplayName(session)}</h2>

      {syncPanel}

      <div
        className="p-4 rounded-xl border space-y-1"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatSessionDate(session.date)}
        </p>
        <p className="text-sm font-semibold">{translateSessionStatus(session.status)}</p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          Formato {formatFormatLabel(teamSize)}
        </p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {formatTeamCountPhrase(teamCount, teamSize)}
        </p>
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
          roster={players}
          onReplaceTeams={(teams, { replaceConfirmed } = {}) =>
            applyTeamChange(
              replaceSessionTeams(sessionsDocument, session.id, teams, {
                roster: players,
                replaceConfirmed,
              })
            )
          }
        />
      )}

      <TeamBuilder
        session={session}
        roster={players}
        showForm={mode === 'manual'}
        onRequestEdit={() => setTeamMode('manual')}
        onAddTeam={(memberIds) =>
          applyTeamChange(
            addSessionTeam(sessionsDocument, session.id, memberIds, {
              roster: players,
            })
          )
        }
        onUpdateTeam={(teamId, memberIds) =>
          applyTeamChange(
            updateSessionTeam(sessionsDocument, session.id, teamId, memberIds, {
              roster: players,
            })
          )
        }
        onRemoveTeam={(teamId) =>
          applyTeamChange(
            removeSessionTeam(sessionsDocument, session.id, teamId, { roster: players })
          )
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

      <RoundBoard
        session={session}
        roster={players}
        canEditScores={inProgress}
        canEditLineups={inProgress}
        onSaveScore={(roundId, matchId, scoreA, scoreB) =>
          persistIfOk(
            setTeamSessionMatchScore(sessionsDocument, session.id, roundId, matchId, scoreA, scoreB)
          )
        }
        onClearScore={(roundId, matchId, { clearConfirmed } = {}) =>
          persistIfOk(
            clearTeamSessionMatchScore(sessionsDocument, session.id, roundId, matchId, {
              clearConfirmed,
            })
          )
        }
        onSaveLineups={(roundId, matchId, lineupAPlayerIds, lineupBPlayerIds) =>
          persistIfOk(
            setTeamSessionMatchLineups(
              sessionsDocument,
              session.id,
              roundId,
              matchId,
              lineupAPlayerIds,
              lineupBPlayerIds,
              { roster: players }
            )
          )
        }
      />

      {inProgress && (
        <div className="space-y-2">
          {!canFinalize && (
            <>
              <p className="text-sm font-semibold">{finalizeProgressLabel}</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {FINALIZE_SCORES_REQUIRED_MESSAGE}
              </p>
            </>
          )}
          {actionError && !confirmReset && !confirmFinalize && (
            <p className="text-xs font-semibold text-red-500">{actionError}</p>
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

      {confirmGenerate && (
        <ConfirmDialog
          titleId="generate-rounds-title"
          title="Gerar rodadas"
          message={generateRoundsConfirmationMessage(teamSize)}
          confirmLabel="Gerar rodadas"
          onConfirm={confirmGenerateRounds}
          onCancel={() => setConfirmGenerate(false)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          titleId="reset-draft-title"
          title={alterTeamsLabel(teamSize)}
          message={resetToDraftConfirmationMessage(teamSize)}
          confirmLabel={`Apagar rodadas e alterar ${units}`}
          onConfirm={confirmResetToDraft}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {confirmFinalize && (
        <ConfirmDialog
          titleId="finalize-session-title"
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
