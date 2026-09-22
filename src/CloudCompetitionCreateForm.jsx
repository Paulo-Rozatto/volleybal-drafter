import { useState } from 'react';
import { localDateString } from './teamGameSessions.js';
import {
  COMPETITION_GRAND_FINAL_MODE_OPTIONS,
  COMPETITION_STRUCTURE_OPTIONS,
  parseCompetitionDateInput,
  parseCompetitionFormatInput,
  parseCompetitionStructureInput,
} from './competitionPresentation.js';
import { createdCloudCompetitionId } from './cloudCompetitionPanel.js';
import { createCloudCompetition } from './supabase/competitionApi.js';

function emptyForm() {
  return {
    date: localDateString(),
    name: '',
    teamSize: 2,
    structure: 'single_elimination',
    roundCount: 3,
    grandFinalMode: 'bracket_reset',
  };
}

export default function CloudCompetitionCreateForm({
  user,
  groupId = null,
  heading = 'Nova competição',
  onCreated,
}) {
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setStatus('');
        try {
          const dateResult = parseCompetitionDateInput(form.date);
          const formatResult = parseCompetitionFormatInput(form.teamSize);
          const structureResult = parseCompetitionStructureInput({
            structure: form.structure,
            roundCount: form.roundCount,
            grandFinalMode: form.grandFinalMode,
          });
          if (!dateResult.ok || !formatResult.ok || !structureResult.ok) {
            setStatus(
              dateResult.dateError ||
                formatResult.teamSizeError ||
                structureResult.roundCountError ||
                structureResult.grandFinalModeError ||
                'Dados inválidos.'
            );
            return;
          }
          const created = await createCloudCompetition({
            date: form.date,
            name: form.name,
            teamSize: formatResult.teamSize,
            groupId: groupId || null,
            stages: structureResult.stages,
          });
          if (!created.ok) {
            setStatus(created.error?.message || 'Não foi possível criar a competição.');
            return;
          }
          const competitionId = createdCloudCompetitionId(created);
          if (!competitionId) {
            setStatus('A competição foi criada, mas o identificador não voltou no resultado.');
            return;
          }
          onCreated?.(competitionId);
        } catch (error) {
          setStatus(error?.message || 'Não foi possível criar a competição.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-bold text-sm">{heading}</h3>
      <input
        type="date"
        value={form.date}
        onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
        className="w-full border p-2 rounded text-sm outline-none"
        style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
      />
      <input
        value={form.name}
        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        placeholder="Nome (opcional)"
        className="w-full border p-2 rounded text-sm outline-none"
        style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={form.teamSize}
          onChange={(event) => setForm((current) => ({ ...current, teamSize: Number(event.target.value) }))}
          className="border p-2 rounded text-sm"
          style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
        >
          {[2, 3, 4, 5, 6].map((size) => (
            <option key={size} value={size}>
              {size}x{size}
            </option>
          ))}
        </select>
        <select
          value={form.structure}
          onChange={(event) => setForm((current) => ({ ...current, structure: event.target.value }))}
          className="border p-2 rounded text-sm"
          style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
        >
          {COMPETITION_STRUCTURE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {form.structure.includes('swiss') ? (
        <input
          type="number"
          min={1}
          value={form.roundCount}
          onChange={(event) => setForm((current) => ({ ...current, roundCount: Number(event.target.value) }))}
          className="w-full border p-2 rounded text-sm outline-none"
          style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
        />
      ) : null}
      {form.structure.includes('double') ? (
        <select
          value={form.grandFinalMode}
          onChange={(event) => setForm((current) => ({ ...current, grandFinalMode: event.target.value }))}
          className="w-full border p-2 rounded text-sm"
          style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
        >
          {COMPETITION_GRAND_FINAL_MODE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="submit"
        disabled={busy || !user}
        className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
      >
        {busy ? 'Criando...' : heading}
      </button>
      {status ? <p className="text-sm font-semibold text-red-500">{status}</p> : null}
    </form>
  );
}
