import React, { useEffect, useState } from 'react';
import { isMatchPending } from './domain/sessionValidation.js';
import { formatMatchScore, matchWinningSide, resolveMatchSideLabel } from './roundDisplay.js';
import { messageForScoreErrors, scoreFieldsToValues } from './scoreInput.js';
import { CLEAR_SCORE_CONFIRMATION_MESSAGE } from './teamGameSessions.js';

function scoreDraftValue(value) {
  return typeof value === 'number' ? String(value) : '';
}

function TeamName({ label, winner }) {
  return (
    <p
      className="text-sm font-semibold break-words leading-snug"
      style={{ color: winner ? 'var(--primary)' : 'var(--text-main)' }}
    >
      {label}
    </p>
  );
}

export default function MatchScoreEditor({
  match,
  teams = [],
  teamSize = 2,
  canEdit = false,
  canClear = false,
  onSave,
  onClear,
}) {
  const [editing, setEditing] = useState(false);
  const [draftA, setDraftA] = useState('');
  const [draftB, setDraftB] = useState('');
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const pending = isMatchPending(match);
  const winner = matchWinningSide(match);
  const labelA = resolveMatchSideLabel(match, 'A', teams, teamSize);
  const labelB = resolveMatchSideLabel(match, 'B', teams, teamSize);

  useEffect(() => {
    if (!confirmClear) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setConfirmClear(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmClear]);

  const openEditor = () => {
    setDraftA(scoreDraftValue(match?.scoreA));
    setDraftB(scoreDraftValue(match?.scoreB));
    setError(null);
    setConflict(null);
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setError(null);
    setConflict(null);
    setDraftA('');
    setDraftB('');
  };

  const handleSave = async () => {
    const { scoreA, scoreB } = scoreFieldsToValues(draftA, draftB);
    try {
      const result = await onSave?.(scoreA, scoreB);
      if (result?.ok) {
        closeEditor();
        return;
      }
      if (result?.errors?.[0]?.code === 'SCORE_VERSION_CONFLICT') {
        setConflict({
          current: result.conflict,
          attempted: { scoreA, scoreB },
        });
        setError(null);
        return;
      }
      setError(messageForScoreErrors(result?.errors));
    } catch (saveError) {
      setError(saveError?.message || 'Não foi possível salvar o placar.');
    }
  };

  const requestClear = async () => {
    try {
      const preview = await onClear?.({ clearConfirmed: false });
      if (preview?.errors?.[0]?.code === 'CLEAR_SCORE_CONFIRMATION_REQUIRED') {
        setConfirmClear(true);
        setError(null);
        return;
      }
      if (!preview?.ok) setError(messageForScoreErrors(preview?.errors));
    } catch (clearError) {
      setError(clearError?.message || 'Não foi possível limpar o placar.');
    }
  };

  const confirmClearScore = async () => {
    try {
      const result = await onClear?.({ clearConfirmed: true });
      if (result?.ok) {
        setConfirmClear(false);
        closeEditor();
        return;
      }
      setError(messageForScoreErrors(result?.errors));
    } catch (clearError) {
      setError(clearError?.message || 'Não foi possível limpar o placar.');
    }
  };

  return (
    <div
      className="rounded-xl border p-3 space-y-2"
      style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
    >
      <TeamName label={labelA} winner={winner === 'A'} />

      {editing ? (
        <div className="space-y-2">
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
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
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
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />
          </div>
          {error && <p className="text-xs font-semibold text-red-500">{error}</p>}
          {conflict?.current && (
            <div className="rounded-lg border p-2 space-y-2" style={{ borderColor: 'var(--border-color)' }}>
              <p className="text-xs font-semibold">Este placar foi alterado por outra pessoa.</p>
              <p className="text-xs">
                Atual: {conflict.current.scoreA} × {conflict.current.scoreB}
              </p>
              <p className="text-xs">
                Seu valor: {conflict.attempted.scoreA} × {conflict.attempted.scoreB}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 font-bold py-2 rounded-lg text-xs cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                  onClick={() => {
                    setConflict(null);
                    closeEditor();
                    onSave?.(conflict.current.scoreA, conflict.current.scoreB, { useCurrent: true });
                  }}
                >
                  Usar atual
                </button>
                <button
                  type="button"
                  className="flex-1 font-bold py-2 rounded-lg text-xs cursor-pointer"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                  onClick={async () => {
                    const result = await onSave?.(
                      conflict.attempted.scoreA,
                      conflict.attempted.scoreB,
                      { expectedVersion: conflict.current.version }
                    );
                    if (result?.ok) closeEditor();
                    else if (result?.errors?.[0]?.code === 'SCORE_VERSION_CONFLICT') {
                      setConflict({
                        current: result.conflict,
                        attempted: conflict.attempted,
                      });
                    } else {
                      setError(messageForScoreErrors(result?.errors));
                    }
                  }}
                >
                  Tentar substituir
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 font-bold py-2 rounded-xl text-sm cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Salvar placar
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
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
      ) : (
        <>
          <p className="text-sm font-bold text-center" style={{ color: 'var(--text-muted)' }}>
            {formatMatchScore(match)}
          </p>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={openEditor}
                className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-main)',
                }}
              >
                {pending ? 'Adicionar placar' : 'Editar placar'}
              </button>
              {canClear && !pending && (
                <button
                  type="button"
                  onClick={requestClear}
                  className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer text-red-500"
                  style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
                >
                  Limpar placar
                </button>
              )}
            </div>
          )}
        </>
      )}

      <TeamName label={labelB} winner={winner === 'B'} />

      {confirmClear && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
          onClick={() => setConfirmClear(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`clear-score-${match?.id}`}
            className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={`clear-score-${match?.id}`} className="font-bold text-base">
              Limpar placar
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {CLEAR_SCORE_CONFIRMATION_MESSAGE}
            </p>
            <button
              type="button"
              onClick={confirmClearScore}
              className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Limpar placar
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
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
      )}
    </div>
  );
}
