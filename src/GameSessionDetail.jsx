import React, { useMemo, useState } from 'react';
import AutomaticTeamBuilder from './AutomaticTeamBuilder.jsx';
import TeamBuilder from './TeamBuilder.jsx';
import RoundBoard from './RoundBoard.jsx';
import SessionPerformanceView from './SessionPerformanceView.jsx';
import {
  SESSION_DETAIL_DEFAULT_VIEW,
  SESSION_DETAIL_GAMES_VIEW,
  SESSION_DETAIL_PERFORMANCE_VIEW,
  SESSION_GAMES_TAB_LABEL,
  SESSION_PERFORMANCE_TAB_LABEL,
  nextSessionDetailView,
} from './sessionPerformancePresentation.js';
import { generateRoundsBlockedReason } from './teamFormationUi.js';
import {
  buildPartnershipRepeatLookup,
  buildPlayerPerformanceIndex,
} from './domain/playerPerformance.js';
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
  canEditSessionScores,
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
import { INVALID_CACHE_CONFIRMATION_REQUIRED } from './persistence/sessionOperations.js';

import ConfirmDialog from './ConfirmDialog.jsx';

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function GameSessionDetail({
  session,
  document = null,
  competitionsDocument = null,
  players = [],
  syncPanel,
  onBack,
  onApplyOperation,
  onEditSession,
  onRequestDelete,
  editButtonRef,
  deleteButtonRef,
}) {
  const [teamMode, setTeamMode] = useState('manual');
  const [detailView, setDetailView] = useState(SESSION_DETAIL_DEFAULT_VIEW);
  const [viewSessionId, setViewSessionId] = useState(session?.id);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmAppendCycle, setConfirmAppendCycle] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [courtCount, setCourtCount] = useState(2);

  if (session?.id !== viewSessionId) {
    setViewSessionId(session?.id);
    setDetailView(SESSION_DETAIL_DEFAULT_VIEW);
    setCourtCount(Number.isInteger(session?.courtCount) ? session.courtCount : 2);
  }

  const showGames = detailView === SESSION_DETAIL_GAMES_VIEW;

  const teamSize = resolveTeamSize(session);
  const units = teamUnitNoun(teamSize, 2);
  const { teamCount } = sessionListStats(session);
  const formatTeamCount = session?.format?.teamCount ?? teamCount;
  const { roundCount, matchCount, completedCount, pendingCount, invalidCount } =
    teamSessionRoundSummary(session);
  const editable = canEditSessionTeams(session);
  const mode = editable ? teamMode : 'manual';
  const canGenerate = canGenerateTeamSessionRounds(session, players);
  const canAppendCycle = canAppendTeamSessionRoundRobinCycle(session);
  const generateBlockedReason = editable && !canGenerate ? generateRoundsBlockedReason(session) : null;
  const inProgress = session?.status === 'in_progress';
  const finished = session?.status === 'finished';
  const canFinalize = canEnableFinalizeTeamSession(session);
  const finalizeProgressLabel = teamSessionFinalizeProgressLabel(session);
  const maxCourts = Math.max(1, Math.floor(Math.max(formatTeamCount, 2) / 2));
  const selectedCourtCount = Math.min(Math.max(courtCount, 1), maxCourts);
  const partnershipIndex = useMemo(
    () => buildPlayerPerformanceIndex(document, players, { competitionsDocument }),
    [document, players, competitionsDocument]
  );
  const partnershipRepeats = useMemo(
    () =>
      partnershipIndex.ok ? buildPartnershipRepeatLookup(partnershipIndex.index) : null,
    [partnershipIndex]
  );

  const applyOperation = (operation) => onApplyOperation?.(operation);

  const persistIfOk = (operation) => {
    const result = applyOperation(operation);
    if (result?.ok) {
      setConfirmGenerate(false);
      setConfirmReset(false);
      setConfirmFinalize(false);
      setConfirmAppendCycle(false);
      setActionError(null);
    }
    return result;
  };

  const applyTeamChange = (operation) => persistIfOk(operation);

  const applyRoundAction = (operation) => {
    const result = persistIfOk(operation);
    if (result?.ok) return result;
    const code = result?.errors?.[0]?.code;
    if (code === 'GENERATE_ROUNDS_CONFIRMATION_REQUIRED') {
      setConfirmGenerate(true);
      setActionError(null);
      return result;
    }
    if (code === 'RESET_TO_DRAFT_CONFIRMATION_REQUIRED') {
      setConfirmReset(true);
      setActionError(null);
      return result;
    }
    if (code === 'FINALIZE_CONFIRMATION_REQUIRED') {
      setConfirmFinalize(true);
      setActionError(null);
      return result;
    }
    if (code === 'APPEND_CYCLE_CONFIRMATION_REQUIRED') {
      setConfirmAppendCycle(true);
      setActionError(null);
      return result;
    }
    if (code === INVALID_CACHE_CONFIRMATION_REQUIRED) return result;
    if (result?.errors?.[0]?.message) setActionError(result.errors[0].message);
    return result;
  };

  const requestGenerateRounds = () => {
    applyRoundAction((document) =>
      startTeamSessionRoundRobin(document, session.id, {
        roster: players,
        courtCount: selectedCourtCount,
        generateConfirmed: false,
      })
    );
  };

  const confirmGenerateRounds = () => {
    applyRoundAction((document) =>
      startTeamSessionRoundRobin(document, session.id, {
        roster: players,
        courtCount: selectedCourtCount,
        generateConfirmed: true,
      })
    );
  };

  const requestAppendCycle = () => {
    applyRoundAction((document) =>
      appendTeamSessionRoundRobinCycle(document, session.id, {
        roster: players,
        courtCount: session.courtCount ?? selectedCourtCount,
        appendConfirmed: false,
      })
    );
  };

  const confirmAppendCycleAction = () => {
    applyRoundAction((document) =>
      appendTeamSessionRoundRobinCycle(document, session.id, {
        roster: players,
        courtCount: session.courtCount ?? selectedCourtCount,
        appendConfirmed: true,
      })
    );
  };

  const requestResetToDraft = () => {
    applyRoundAction((document) =>
      resetTeamSessionToDraftForTeamEditing(document, session.id, {
        resetConfirmed: false,
      })
    );
  };

  const confirmResetToDraft = () => {
    applyRoundAction((document) =>
      resetTeamSessionToDraftForTeamEditing(document, session.id, {
        resetConfirmed: true,
      })
    );
  };

  const requestFinalize = () => {
    applyRoundAction((document) =>
      finalizeTeamSession(document, session.id, {
        finalizeConfirmed: false,
      })
    );
  };

  const confirmFinalizeSession = () => {
    applyRoundAction((document) =>
      finalizeTeamSession(document, session.id, {
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

      <div className="flex gap-2">
        {onEditSession && (
          <button
            ref={editButtonRef}
            type="button"
            onClick={onEditSession}
            className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
          >
            Editar encontro
          </button>
        )}
        {onRequestDelete && (
          <button
            ref={deleteButtonRef}
            type="button"
            onClick={onRequestDelete}
            className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer underline"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
          >
            Excluir encontro
          </button>
        )}
      </div>

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

      <div
        className="flex rounded-lg p-1 gap-1"
        style={{ backgroundColor: 'var(--bg-subtle)' }}
        role="tablist"
        aria-label="Visualização do encontro"
      >
        <button
          type="button"
          role="tab"
          aria-selected={showGames}
          onClick={() => setDetailView(nextSessionDetailView(detailView, SESSION_DETAIL_GAMES_VIEW))}
          className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
          style={{
            backgroundColor: showGames ? 'var(--primary)' : 'transparent',
            color: showGames ? 'var(--text-inverse)' : 'var(--text-muted)',
          }}
        >
          {SESSION_GAMES_TAB_LABEL}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!showGames}
          onClick={() =>
            setDetailView(nextSessionDetailView(detailView, SESSION_DETAIL_PERFORMANCE_VIEW))
          }
          className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
          style={{
            backgroundColor: !showGames ? 'var(--primary)' : 'transparent',
            color: !showGames ? 'var(--text-inverse)' : 'var(--text-muted)',
          }}
        >
          {SESSION_PERFORMANCE_TAB_LABEL}
        </button>
      </div>

      {!showGames && (
        <SessionPerformanceView
          document={document}
          competitionsDocument={competitionsDocument}
          roster={players}
          sessionId={session.id}
        />
      )}

      {showGames && (
      <>
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
          partnershipRepeats={partnershipRepeats}
          onReplaceTeams={(teams, { replaceConfirmed } = {}) =>
            applyTeamChange((document) =>
              replaceSessionTeams(document, session.id, teams, {
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
          applyTeamChange((document) =>
            addSessionTeam(document, session.id, memberIds, {
              roster: players,
            })
          )
        }
        onUpdateTeam={(teamId, memberIds) =>
          applyTeamChange((document) =>
            updateSessionTeam(document, session.id, teamId, memberIds, {
              roster: players,
            })
          )
        }
        onRemoveTeam={(teamId) =>
          applyTeamChange((document) =>
            removeSessionTeam(document, session.id, teamId, { roster: players })
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

      <RoundBoard
        session={session}
        roster={players}
        canEditScores={canEditSessionScores(session)}
        canClearScores={canClearSessionScores(session)}
        canEditLineups={inProgress}
        onSaveScore={(roundId, matchId, scoreA, scoreB) =>
          persistIfOk((document) =>
            setTeamSessionMatchScore(document, session.id, roundId, matchId, scoreA, scoreB)
          )
        }
        onClearScore={(roundId, matchId, { clearConfirmed } = {}) =>
          persistIfOk((document) =>
            clearTeamSessionMatchScore(document, session.id, roundId, matchId, {
              clearConfirmed,
            })
          )
        }
        onSaveLineups={(roundId, matchId, lineupAPlayerIds, lineupBPlayerIds) =>
          persistIfOk((document) =>
            setTeamSessionMatchLineups(
              document,
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
          {actionError && !confirmReset && !confirmFinalize && !confirmAppendCycle && (
            <p className="text-xs font-semibold text-red-500">{actionError}</p>
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
      </>
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

      {confirmAppendCycle && (
        <ConfirmDialog
          titleId="append-cycle-title"
          title="Gerar nova sequência"
          message={APPEND_ROUND_ROBIN_CYCLE_CONFIRMATION_MESSAGE}
          confirmLabel="Gerar nova sequência"
          onConfirm={confirmAppendCycleAction}
          onCancel={() => setConfirmAppendCycle(false)}
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
