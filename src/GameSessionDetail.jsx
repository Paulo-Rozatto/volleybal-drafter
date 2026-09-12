import React, { useEffect, useState } from 'react';
import AutomaticPairBuilder from './AutomaticPairBuilder.jsx';
import PairBuilder from './PairBuilder.jsx';
import RoundBoard from './RoundBoard.jsx';
import {
  addSessionPair,
  canEditSessionPairs,
  canGenerateSessionRounds,
  clearSessionMatchScore,
  formatSessionDate,
  GENERATE_ROUNDS_CONFIRMATION_MESSAGE,
  removeSessionPair,
  replaceSessionPairs,
  RESET_TO_DRAFT_CONFIRMATION_MESSAGE,
  resetSessionToDraftForPairEditing,
  sessionDisplayName,
  sessionIsReadyToFinalize,
  sessionListStats,
  sessionRoundSummary,
  setSessionMatchScore,
  startSessionRoundRobin,
  translateSessionStatus,
  updateSessionPair,
} from './gameSessions.js';

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
  const [pairMode, setPairMode] = useState('manual');
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [actionError, setActionError] = useState(null);

  const { pairCount } = sessionListStats(session);
  const { roundCount, matchCount, completedCount, pendingCount, invalidCount } = sessionRoundSummary(session);
  const editable = canEditSessionPairs(session);
  const mode = editable ? pairMode : 'manual';
  const canGenerate = canGenerateSessionRounds(session, players);
  const tooFewPairs = (session?.pairs?.length ?? 0) < 2;
  const inProgress = session?.status === 'in_progress';
  const readyToFinalize = sessionIsReadyToFinalize(session);

  const persistIfOk = (result) => {
    if (result?.ok) {
      onApplyDocument?.(result.document);
      setConfirmGenerate(false);
      setConfirmReset(false);
      setActionError(null);
    }
    return result;
  };

  const applyPairChange = (result) => persistIfOk(result);

  const applyRoundAction = (result) => {
    if (result?.ok) return persistIfOk(result);
    if (result?.errors?.[0]?.message) setActionError(result.errors[0].message);
    return result;
  };

  const requestGenerateRounds = () => {
    const result = startSessionRoundRobin(sessionsDocument, session.id, {
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
      startSessionRoundRobin(sessionsDocument, session.id, {
        roster: players,
        generateConfirmed: true,
      })
    );
  };

  const requestResetToDraft = () => {
    const result = resetSessionToDraftForPairEditing(sessionsDocument, session.id, {
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
      resetSessionToDraftForPairEditing(sessionsDocument, session.id, {
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
          {pluralize(pairCount, 'dupla', 'duplas')}
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
            onClick={() => setPairMode('manual')}
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
            onClick={() => setPairMode('auto')}
            className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
            style={{
              backgroundColor: mode === 'auto' ? 'var(--primary)' : 'transparent',
              color: mode === 'auto' ? 'var(--text-inverse)' : 'var(--text-muted)',
            }}
          >
            Sortear duplas
          </button>
        </div>
      )}

      {mode === 'auto' && (
        <AutomaticPairBuilder
          key={session.updatedAt}
          session={session}
          roster={players}
          onReplacePairs={(pairs, { replaceConfirmed } = {}) =>
            applyPairChange(
              replaceSessionPairs(sessionsDocument, session.id, pairs, players, { replaceConfirmed })
            )
          }
        />
      )}

      <PairBuilder
        session={session}
        roster={players}
        showForm={mode === 'manual'}
        onRequestEdit={() => setPairMode('manual')}
        onAddPair={(playerA, playerB) =>
          applyPairChange(addSessionPair(sessionsDocument, session.id, { playerA, playerB }, players))
        }
        onUpdatePair={(pairId, playerA, playerB) =>
          applyPairChange(
            updateSessionPair(sessionsDocument, session.id, pairId, { playerA, playerB }, players)
          )
        }
        onRemovePair={(pairId) =>
          applyPairChange(removeSessionPair(sessionsDocument, session.id, pairId, players))
        }
      />

      {editable && (
        <div className="space-y-2">
          {tooFewPairs && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Forme pelo menos duas duplas para gerar os jogos.
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
            setSessionMatchScore(sessionsDocument, session.id, roundId, matchId, scoreA, scoreB)
          )
        }
        onClearScore={(roundId, matchId, { clearConfirmed } = {}) =>
          persistIfOk(
            clearSessionMatchScore(sessionsDocument, session.id, roundId, matchId, { clearConfirmed })
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
            Alterar duplas
          </button>
        </div>
      )}

      {confirmGenerate && (
        <ConfirmDialog
          titleId="generate-rounds-title"
          title="Gerar rodadas"
          message={GENERATE_ROUNDS_CONFIRMATION_MESSAGE}
          confirmLabel="Gerar rodadas"
          onConfirm={confirmGenerateRounds}
          onCancel={() => setConfirmGenerate(false)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          titleId="reset-draft-title"
          title="Alterar duplas"
          message={RESET_TO_DRAFT_CONFIRMATION_MESSAGE}
          confirmLabel="Apagar rodadas e alterar duplas"
          onConfirm={confirmResetToDraft}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
