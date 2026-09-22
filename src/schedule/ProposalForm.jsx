import { useState } from 'react';
import {
  DEFAULT_GROUP_TIMEZONE,
  SLOT_MINUTES,
  WINDOW_DURATIONS,
  zonedLocalToUtc,
  zonedParts,
} from '../domain/groupAvailability.js';
import Button from '../ui/Button.jsx';
import LocationField from './LocationField.jsx';
import { durationLabel, timezoneHint } from './labels.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

function initialForm(draft, timeZone) {
  const start = draft?.startsAt ? new Date(draft.startsAt) : new Date();
  const parts = zonedParts(start, timeZone) ?? zonedParts(new Date(), timeZone);
  const duration = draft?.endsAt
    ? Math.round((new Date(draft.endsAt).getTime() - start.getTime()) / 60000)
    : 120;
  return {
    title: draft?.title ?? 'Jogo',
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    hour: parts.hour,
    minute: parts.minute >= 30 ? 30 : 0,
    duration: WINDOW_DURATIONS.includes(duration) ? duration : 120,
    locationName: draft?.locationName ?? '',
    locationDetails: draft?.locationDetails ?? '',
    notes: draft?.notes ?? '',
  };
}

export default function ProposalForm({
  timeZone = DEFAULT_GROUP_TIMEZONE,
  draft = null,
  submitLabel = 'Criar proposta',
  busy = false,
  onSubmit,
  onCancel,
}) {
  const [form, setForm] = useState(() => initialForm(draft, timeZone));

  function setField(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const [year, month, day] = form.date.split('-').map(Number);
        const startsAt = zonedLocalToUtc(timeZone, year, month, day, Number(form.hour), Number(form.minute));
        const endsAt = new Date(startsAt.getTime() + Number(form.duration) * 60 * 1000);
        onSubmit?.({
          title: form.title,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          locationName: form.locationName,
          locationDetails: form.locationDetails,
          notes: form.notes,
        });
      }}
    >
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        {timezoneHint(timeZone)}
      </p>
      <label className="block text-small font-semibold">
        Título
        <input
          required
          maxLength={80}
          value={form.title}
          onChange={(event) => setField({ title: event.target.value })}
          className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </label>
      <label className="block text-small font-semibold">
        Data
        <input
          required
          type="date"
          value={form.date}
          onChange={(event) => setField({ date: event.target.value })}
          className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-small font-semibold">
          Início
          <select
            value={`${pad(form.hour)}:${pad(form.minute)}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(':').map(Number);
              setField({ hour, minute });
            }}
            className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
            style={{
              backgroundColor: 'var(--bg-app)',
              color: 'var(--text-main)',
              borderColor: 'var(--border-color)',
            }}
          >
            {Array.from({ length: 48 }, (_, index) => {
              const hour = Math.floor(index / 2);
              const minute = index % 2 === 0 ? 0 : SLOT_MINUTES;
              return (
                <option key={`${hour}:${minute}`} value={`${pad(hour)}:${pad(minute)}`}>
                  {pad(hour)}:{pad(minute)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="block text-small font-semibold">
          Duração
          <select
            value={form.duration}
            onChange={(event) => setField({ duration: Number(event.target.value) })}
            className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
            style={{
              backgroundColor: 'var(--bg-app)',
              color: 'var(--text-main)',
              borderColor: 'var(--border-color)',
            }}
          >
            {WINDOW_DURATIONS.map((duration) => (
              <option key={duration} value={duration}>
                {durationLabel(duration)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LocationField
        locationName={form.locationName}
        locationDetails={form.locationDetails}
        onChange={(patch) => setField(patch)}
      />
      <label className="block text-small font-semibold">
        Observações
        <textarea
          maxLength={500}
          rows={2}
          value={form.notes}
          onChange={(event) => setField({ notes: event.target.value })}
          placeholder="Levar bola"
          className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
