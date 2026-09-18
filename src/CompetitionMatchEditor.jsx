import React, { useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import {
  CLEAR_COMPETITION_RESULT_CONFIRMATION_MESSAGE,
  CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED,
  COMPETITION_DOWNSTREAM_CONFIRMATION_MESSAGE,
  COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED,
} from './competitions.js';
import {
  competitionTeamSize,
  defaultMatchPlayedDate,
  downstreamConfirmationDetails,
  matchEditorTitle,
} from './competitionPresentation.js';
import { messageForScoreErrors, scoreFieldsToValues } from './scoreInput.js';
import { formatSessionDate } from './teamGameSessions.js';

function scoreDraftValue(value) {
  return typeof value === 'number' ? String(value) : '';
}

function Members({ names }) {
  if (!names?.length) return null;
  return (
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
      {names.join(', ')}
    </p>
  );
}

export default function CompetitionMatchEditor({
  competition,
  slot,
  openerRef,
  onSave,
  onClear,
  onClose,
}) {
  const match = slot?.match;
  const teamSize = competitionTeamSize(competition);
  const cancelRef = useRef(null);
  const [draftA, setDraftA] = useState(scoreDraftValue(match?.scoreA));
  const [draftB, setDraftB] = useState(scoreDraftValue(match?.scoreB));
  const [playedDate, setPlayedDate] = useState(defaultMatchPlayedDate(competition, match));
  const [error, setError] = useState(null);
  const [pendingSave, setPendingSave] = useState(null);
  const [pendingClear, setPendingClear] = useState(false);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  if (!slot || slot.type !== 'match' || !match) return null;

  const applySave = (downstreamConfirmed) => {
    const { scoreA, scoreB } = scoreFieldsToValues(draftA, draftB);
    const result = onSave?.({
      scoreA,
      scoreB,
      playedDate,
      downstreamConfirmed,
    });
    if (result?.errors?.[0]?.code === COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED) {
      setPendingSave(result.errors[0]);
      setError(null);
      return result;
    }
    if (result?.ok) {
      onClose?.();
      return result;
    }
    setError(messageForScoreErrors(result?.errors));
    return result;
  };

  const applyClear = ({ clearConfirmed = false, downstreamConfirmed = false } = {}) => {
    const result = onClear?.({ clearConfirmed, downstreamConfirmed });
    if (result?.errors?.[0]?.code === CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED) {
      setPendingClear(true);
      setError(null);
      return result;
    }
    if (result?.ok) {
      onClose?.();
      return result;
    }
    setError(messageForScoreErrors(result?.errors));
    return result;
  };

  const inputStyle = {
    backgroundColor: 'var(--bg-app)',
    color: 'var(--text-main)',
    borderColor: 'var(--border-color)',
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="competition-match-editor-title"
          className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-main)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="competition-match-editor-title" className="font-bold text-base">
            {matchEditorTitle(slot)}
          </h3>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-bold">{slot.sideA.label}</p>
              <Members names={slot.sideA.members} />
            </div>
            <div>
              <p className="text-sm font-bold">{slot.sideB.label}</p>
              <Members names={slot.sideB.members} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={draftA}
              onChange={(event) => {
                setDraftA(event.target.value);
                setError(null);
              }}
              aria-label={teamSize === 2 ? 'Placar da dupla A' : 'Placar do time A'}
              className="w-full border rounded-lg p-2 text-center text-sm font-bold outline-none"
              style={inputStyle}
            />
            <span className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>
              ×
            </span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={draftB}
              onChange={(event) => {
                setDraftB(event.target.value);
                setError(null);
              }}
              aria-label={teamSize === 2 ? 'Placar da dupla B' : 'Placar do time B'}
              className="w-full border rounded-lg p-2 text-center text-sm font-bold outline-none"
              style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-sm font-bold" htmlFor="competition-match-date">
              Data da partida
            </label>
            <input
              id="competition-match-date"
              type="date"
              required
              value={playedDate}
              onChange={(event) => {
                setPlayedDate(event.target.value);
                setError(null);
              }}
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            />
            {playedDate && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {formatSessionDate(playedDate)}
              </p>
            )}
          </div>

          {error && <p className="text-xs font-semibold text-red-500">{error}</p>}

          <button
            type="button"
            onClick={() => applySave(false)}
            className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            Salvar resultado
          </button>
          {match.winnerTeamId && (
            <button
              type="button"
              onClick={() => applyClear()}
              className="w-full font-bold py-3 rounded-xl border cursor-pointer text-red-500"
              style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
            >
              Limpar placar
            </button>
          )}
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="w-full font-bold py-3 rounded-xl border cursor-pointer"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
          >
            Cancelar
          </button>
        </div>
      </div>

      {pendingSave && (
        <ConfirmDialog
          titleId="competition-downstream-title"
          title="Resultados seguintes serão apagados"
          message={pendingSave.message || COMPETITION_DOWNSTREAM_CONFIRMATION_MESSAGE}
          confirmLabel="Apagar resultados seguintes e salvar"
          destructive
          openerRef={openerRef}
          onConfirm={() => {
            setPendingSave(null);
            applySave(true);
          }}
          onCancel={() => setPendingSave(null)}
        >
          {downstreamConfirmationDetails(pendingSave, competition).map((line) => (
            <p key={line} className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {line}
            </p>
          ))}
        </ConfirmDialog>
      )}

      {pendingClear && (
        <ConfirmDialog
          titleId="competition-clear-title"
          title="Limpar placar"
          message={CLEAR_COMPETITION_RESULT_CONFIRMATION_MESSAGE}
          confirmLabel="Limpar placar"
          destructive
          openerRef={openerRef}
          onConfirm={() => {
            setPendingClear(false);
            applyClear({ clearConfirmed: true, downstreamConfirmed: true });
          }}
          onCancel={() => setPendingClear(false)}
        />
      )}
    </>
  );
}
