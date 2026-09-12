import React, { useState } from 'react';
import GameSessionDetail from './GameSessionDetail.jsx';
import { validateDate } from './domain/sessionValidation.js';
import { parseSessionFormatInput } from './teamFormationUi.js';
import {
  SESSION_FORMAT_OPTIONS,
  formatTeamCountPhrase,
  resolveTeamSize,
} from './teamPresentation.js';
import {
  formatSessionDate,
  localDateString,
  sessionListStats,
  sessionsForDisplay,
  translateSessionStatus,
} from './teamGameSessions.js';

function emptyForm() {
  return {
    date: localDateString(),
    name: '',
    teamSize: 2,
    teamCount: 2,
  };
}

export default function GameSessionsView({
  sessions = [],
  sessionsDocument,
  players = [],
  onCreateSession,
  onApplyDocument,
  syncPanel,
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [dateError, setDateError] = useState(null);
  const [teamSizeError, setTeamSizeError] = useState(null);
  const [teamCountError, setTeamCountError] = useState(null);
  const [openSessionId, setOpenSessionId] = useState(null);

  const visibleSessions = sessionsForDisplay(sessions);
  const openSession = sessions.find((item) => item.id === openSessionId) ?? null;

  if (openSessionId) {
    if (!openSession) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setOpenSessionId(null)}
            className="font-bold text-sm py-2 cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            ← Voltar para encontros
          </button>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Encontro não encontrado.
          </p>
          {syncPanel}
        </div>
      );
    }

    return (
      <GameSessionDetail
        session={openSession}
        sessionsDocument={sessionsDocument}
        players={players}
        syncPanel={syncPanel}
        onBack={() => setOpenSessionId(null)}
        onApplyDocument={onApplyDocument}
      />
    );
  }

  const clearFormatErrors = () => {
    setTeamSizeError(null);
    setTeamCountError(null);
  };

  const openForm = () => {
    setForm(emptyForm());
    setDateError(null);
    clearFormatErrors();
    setIsCreating(true);
  };

  const closeForm = () => {
    setForm(emptyForm());
    setDateError(null);
    clearFormatErrors();
    setIsCreating(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const dateResult = validateDate(form.date);
    if (!dateResult.ok) {
      setDateError(dateResult.errors[0]?.message || 'A data do encontro é inválida.');
      return;
    }

    const formatResult = parseSessionFormatInput({
      teamSize: form.teamSize,
      teamCount: form.teamCount,
    });
    if (!formatResult.ok) {
      setTeamSizeError(formatResult.teamSizeError);
      setTeamCountError(
        formatResult.teamCountError || 'Informe uma quantidade de times inteira de no mínimo 2.'
      );
      return;
    }

    onCreateSession?.({
      date: form.date,
      name: form.name,
      teamSize: formatResult.format.teamSize,
      teamCount: formatResult.format.teamCount,
    });
    closeForm();
  };

  const inputStyle = {
    backgroundColor: 'var(--bg-app)',
    color: 'var(--text-main)',
    borderColor: 'var(--border-color)',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Encontros</h2>
        {!isCreating && (
          <button
            type="button"
            onClick={openForm}
            className="px-3 py-2 rounded-xl font-bold text-sm shadow-md cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            Novo encontro
          </button>
        )}
      </div>

      {syncPanel}

      {isCreating && (
        <form
          onSubmit={handleSubmit}
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <label className="block text-sm font-bold" style={{ color: 'var(--text-main)' }}>
            Data
            <input
              type="date"
              required
              value={form.date}
              onChange={(event) => {
                setForm((current) => ({ ...current, date: event.target.value }));
                setDateError(null);
              }}
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            />
          </label>

          {dateError && (
            <p className="text-xs font-semibold text-red-500">{dateError}</p>
          )}

          <label className="block text-sm font-bold" style={{ color: 'var(--text-main)' }}>
            Formato
            <select
              required
              value={form.teamSize}
              onChange={(event) => {
                setForm((current) => ({ ...current, teamSize: Number(event.target.value) }));
                setTeamSizeError(null);
              }}
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            >
              {SESSION_FORMAT_OPTIONS.map((option) => (
                <option key={option.teamSize} value={option.teamSize}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {teamSizeError && (
            <p className="text-xs font-semibold text-red-500">{teamSizeError}</p>
          )}

          <label className="block text-sm font-bold" style={{ color: 'var(--text-main)' }}>
            Quantidade de times
            <input
              type="number"
              required
              min="2"
              step="1"
              value={form.teamCount}
              onChange={(event) => {
                setForm((current) => ({ ...current, teamCount: event.target.value }));
                setTeamCountError(null);
              }}
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            />
          </label>

          {teamCountError && (
            <p className="text-xs font-semibold text-red-500">{teamCountError}</p>
          )}

          <label className="block text-sm font-bold" style={{ color: 'var(--text-main)' }}>
            Nome (opcional)
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Sábado na Arena"
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            />
          </label>

          <div className="flex gap-2 text-sm">
            <button
              type="submit"
              className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Criar encontro
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="flex-1 font-bold py-3 rounded-xl border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-main)',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {visibleSessions.length === 0 ? (
        <div
          className="text-center py-8 rounded-xl border border-dashed text-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          Nenhum encontro ainda. Toque em “Novo encontro” para registrar o primeiro.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleSessions.map((session) => {
            const { teamCount, matchCount } = sessionListStats(session);
            const teamSize = resolveTeamSize(session);
            return (
              <article
                key={session.id}
                className="p-4 rounded-xl border space-y-2"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{formatSessionDate(session.date)}</p>
                    {session.name && (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {session.name}
                      </p>
                    )}
                  </div>
                  <span
                    className="shrink-0 text-xs font-semibold px-2 py-1 rounded-lg"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                  >
                    {translateSessionStatus(session.status)}
                  </span>
                </div>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {formatTeamCountPhrase(teamCount, teamSize)} · {matchCount}{' '}
                  {matchCount === 1 ? 'jogo' : 'jogos'}
                </p>
                <button
                  type="button"
                  onClick={() => setOpenSessionId(session.id)}
                  className="w-full font-bold py-2 rounded-xl border text-sm cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-main)',
                  }}
                >
                  Abrir encontro
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
