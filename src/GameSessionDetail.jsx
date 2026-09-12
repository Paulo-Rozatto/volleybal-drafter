import React, { useEffect, useState } from 'react';
import AutomaticTeamBuilder from './AutomaticTeamBuilder.jsx';
import TeamBuilder from './TeamBuilder.jsx';
import RoundBoard from './RoundBoard.jsx';
import {
  addSessionTeam,
  canEditSessionTeams,
  canGenerateTeamSessionRounds,
  clearTeamSessionMatchScore,
  formatSessionDate,
  GENERATE_TEAM_ROUNDS_CONFIRMATION_MESSAGE,
  removeSessionTeam,
  replaceSessionTeams,
  RESET_TEAM_SESSION_TO_DRAFT_CONFIRMATION_MESSAGE,
  resetTeamSessionToDraftForTeamEditing,
  sessionDisplayName,
  sessionListStats,
  setTeamSessionMatchScore,
  startTeamSessionRoundRobin,
  teamSessionIsReadyToFinalize,
  teamSessionRoundSummary,
  translateSessionStatus,
  updateSessionTeam,
  usesDoublesLabels,
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
  const [actionError, setActionError] = useState(null);

  const doubles = usesDoublesLabels(session);
  const unit = doubles ? 'dupla' : 'time';
  const units = doubles ? 'duplas' : 'times';
  const { teamCount } = sessionListStats(session);
  const expectedTeamCount = session?.format?.teamCount ?? 2;
  const { roundCount, matchCount, completedCount, pendingCount, invalidCount } =
    teamSessionRoundSummary(session);
  const editable = canEditSessionTeams(session);
  const mode = editable ? teamMode : 'manual';
  const canGenerate = canGenerateTeamSessionRounds(session, players);
  const incompleteRoster = teamCount !== expectedTeamCount;
  const inProgress = session?.status === 'in_progress';
  const readyToFinalize = teamSessionIsReadyToFinalize(session);

  const persistIfOk = (result) => {
    if (result?.ok) {
      onApplyDocument?.(result.document);
      setConfirmGenerate(false);
      setConfirmReset(false);
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
          Formato {session?.format?.teamSize ?? 2}x{session?.format?.teamSize ?? 2}
        </p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {pluralize(teamCount, unit, units)}
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

      {readyToFinalize && (
        <div
          className="p-4 rounded-xl border"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--primary)' }}
        >
          <p className="text-sm font-bold">
            Todos os jogos foram concluídos. O encontro já pode ser finalizado.
          </p>
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
            Sortear {units}
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
        onAddTeam={(playerA, playerB) =>
          applyTeamChange(
            addSessionTeam(sessionsDocument, session.id, [playerA?.id, playerB?.id], {
              roster: players,
            })
          )
        }
        onUpdateTeam={(teamId, playerA, playerB) =>
          applyTeamChange(
            updateSessionTeam(sessionsDocument, session.id, teamId, [playerA?.id, playerB?.id], {
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
          {incompleteRoster && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Forme todas as {units} para gerar os jogos.
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
        canEditScores={inProgress}
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
      />

      {inProgress && (
        <div className="space-y-2">
          {actionError && !confirmReset && (
            <p className="text-xs font-semibold text-red-500">{actionError}</p>
          )}
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
            Alterar {units}
          </button>
        </div>
      )}

      {confirmGenerate && (
        <ConfirmDialog
          titleId="generate-rounds-title"
          title="Gerar rodadas"
          message={GENERATE_TEAM_ROUNDS_CONFIRMATION_MESSAGE}
          confirmLabel="Gerar rodadas"
          onConfirm={confirmGenerateRounds}
          onCancel={() => setConfirmGenerate(false)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          titleId="reset-draft-title"
          title={`Alterar ${units}`}
          message={RESET_TEAM_SESSION_TO_DRAFT_CONFIRMATION_MESSAGE}
          confirmLabel={`Apagar rodadas e alterar ${units}`}
          onConfirm={confirmResetToDraft}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
