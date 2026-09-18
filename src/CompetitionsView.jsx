import React, { useState } from 'react';
import CompetitionDetail from './CompetitionDetail.jsx';
import {
  competitionFormatOptions,
  competitionListItem,
  COMPETITION_GRAND_FINAL_MODE_OPTIONS,
  COMPETITION_STRUCTURE_OPTIONS,
  competitionsForDisplay,
  parseCompetitionDateInput,
  parseCompetitionFormatInput,
  parseCompetitionStructureInput,
} from './competitionPresentation.js';
import { localDateString } from './teamGameSessions.js';

function emptyForm() {
  return {
    date: localDateString(),
    name: '',
    teamSize: 2,
    structure: 'swiss_then_double',
    roundCount: 3,
    grandFinalMode: 'bracket_reset',
  };
}

export default function CompetitionsView({
  competitions = [],
  document,
  players = [],
  cacheInvalid = false,
  cacheError = null,
  onCreateCompetition,
  onApplyOperation,
  syncPanel,
}) {
  const [openCompetitionId, setOpenCompetitionId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [dateError, setDateError] = useState(null);
  const [teamSizeError, setTeamSizeError] = useState(null);
  const [roundCountError, setRoundCountError] = useState(null);
  const [grandFinalModeError, setGrandFinalModeError] = useState(null);

  const openCompetition = (competitions ?? []).find((item) => item?.id === openCompetitionId) ?? null;
  const visible = competitionsForDisplay(competitions).map(competitionListItem);
  const inputStyle = {
    backgroundColor: 'var(--bg-app)',
    color: 'var(--text-main)',
    borderColor: 'var(--border-color)',
  };

  if (openCompetitionId) {
    if (!openCompetition) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setOpenCompetitionId(null)}
            className="font-bold text-sm py-2 cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            ← Voltar para competições
          </button>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Competição não encontrada.
          </p>
          {syncPanel}
        </div>
      );
    }

    return (
      <CompetitionDetail
        competition={openCompetition}
        document={document}
        players={players}
        syncPanel={syncPanel}
        onBack={() => setOpenCompetitionId(null)}
        onApplyOperation={onApplyOperation}
      />
    );
  }

  const handleCreateSubmit = (event) => {
    event.preventDefault();
    setDateError(null);
    setTeamSizeError(null);
    setRoundCountError(null);
    setGrandFinalModeError(null);

    const dateResult = parseCompetitionDateInput(form.date);
    if (!dateResult.ok) {
      setDateError(dateResult.dateError);
      return;
    }

    const formatResult = parseCompetitionFormatInput(form.teamSize);
    if (!formatResult.ok) {
      setTeamSizeError(formatResult.teamSizeError);
      return;
    }

    const structureResult = parseCompetitionStructureInput({
      structure: form.structure,
      roundCount: form.roundCount,
      grandFinalMode: form.grandFinalMode,
    });
    if (!structureResult.ok) {
      setRoundCountError(structureResult.roundCountError);
      setGrandFinalModeError(structureResult.grandFinalModeError);
      return;
    }

    const created = onCreateCompetition?.({
      date: form.date,
      name: form.name,
      teamSize: formatResult.teamSize,
      stages: structureResult.stages,
    });
    if (created?.ok === false) return;
    const createdId = created?.competition?.id;
    setIsCreating(false);
    setForm(emptyForm());
    if (createdId) setOpenCompetitionId(createdId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Competições</h2>
        {!isCreating && (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm());
              setDateError(null);
              setTeamSizeError(null);
              setRoundCountError(null);
              setGrandFinalModeError(null);
              setIsCreating(true);
            }}
            className="px-3 py-2 rounded-xl font-bold text-sm shadow-md cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            + Nova competição
          </button>
        )}
      </div>

      {syncPanel}

      {cacheInvalid && (
        <div
          className="p-4 rounded-xl border space-y-1"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--primary)' }}
        >
          <p className="text-sm font-bold">O cache local de competições está inválido.</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Criar ou editar uma competição não vai sobrescrever os dados locais até você confirmar a
            substituição.
          </p>
          {cacheError && <p className="text-xs font-semibold text-red-500">{cacheError}</p>}
        </div>
      )}

      {isCreating && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <div>
            <label className="block text-sm font-bold" htmlFor="create-competition-name">
              Nome
            </label>
            <input
              id="create-competition-name"
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="create-competition-date">
              Data inicial
            </label>
            <input
              id="create-competition-date"
              type="date"
              required
              value={form.date}
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            />
            {dateError && <p className="mt-1 text-xs font-semibold text-red-500">{dateError}</p>}
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="create-competition-format">
              Formato
            </label>
            <select
              id="create-competition-format"
              required
              value={form.teamSize}
              onChange={(event) =>
                setForm((current) => ({ ...current, teamSize: Number(event.target.value) }))
              }
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            >
              {competitionFormatOptions().map((option) => (
                <option key={option.teamSize} value={option.teamSize}>
                  {option.label}
                </option>
              ))}
            </select>
            {teamSizeError && (
              <p className="mt-1 text-xs font-semibold text-red-500">{teamSizeError}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="create-competition-structure">
              Estrutura
            </label>
            <select
              id="create-competition-structure"
              value={form.structure}
              onChange={(event) =>
                setForm((current) => ({ ...current, structure: event.target.value }))
              }
              className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
              style={inputStyle}
            >
              {COMPETITION_STRUCTURE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {(form.structure === 'swiss' || form.structure === 'swiss_then_double') && (
            <div>
              <label className="block text-sm font-bold" htmlFor="create-competition-rounds">
                Rodadas suíças
              </label>
              <input
                id="create-competition-rounds"
                type="number"
                min="1"
                required
                value={form.roundCount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, roundCount: Number(event.target.value) }))
                }
                className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
                style={inputStyle}
              />
              {roundCountError && (
                <p className="mt-1 text-xs font-semibold text-red-500">{roundCountError}</p>
              )}
            </div>
          )}
          {(form.structure === 'double_elimination' || form.structure === 'swiss_then_double') && (
            <div>
              <label className="block text-sm font-bold" htmlFor="create-competition-grand-final">
                Grand Final
              </label>
              <select
                id="create-competition-grand-final"
                value={form.grandFinalMode}
                onChange={(event) =>
                  setForm((current) => ({ ...current, grandFinalMode: event.target.value }))
                }
                className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
                style={inputStyle}
              >
                {COMPETITION_GRAND_FINAL_MODE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {grandFinalModeError && (
                <p className="mt-1 text-xs font-semibold text-red-500">{grandFinalModeError}</p>
              )}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="submit"
              className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Criar competição
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
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

      {visible.length === 0 ? (
        <div
          className="text-center py-8 rounded-xl border border-dashed text-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          Nenhuma competição ainda. Toque em “+ Nova competição” para criar a primeira.
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <article
              key={item.id}
              className="p-4 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{item.name}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {item.dateLabel}
                  </p>
                </div>
                <span
                  className="shrink-0 text-xs font-semibold px-2 py-1 rounded-lg"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                >
                  {item.statusLabel}
                </span>
              </div>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {item.teamCountLabel} · {item.formatLabel} · {item.phaseLabel}
              </p>
              {item.championLabel && (
                <p className="text-sm font-bold">🏆 {item.championLabel}</p>
              )}
              <button
                type="button"
                onClick={() => setOpenCompetitionId(item.id)}
                className="w-full font-bold py-2 rounded-xl border text-sm cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-main)',
                }}
              >
                Abrir competição
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
