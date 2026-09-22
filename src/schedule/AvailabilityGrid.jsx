import { useMemo, useRef, useState } from 'react';
import { WEEKDAY_SHORT_PT, memberDisplayName, timezoneHint } from './labels.js';

function intensityColor(count, total) {
  if (!total || count <= 0) return 'var(--bg-subtle)';
  const ratio = Math.min(1, count / total);
  return `color-mix(in srgb, var(--primary) ${Math.round(18 + ratio * 62)}%, var(--bg-subtle))`;
}

export default function AvailabilityGrid({
  grid,
  members = [],
  myUserId,
  selected = new Set(),
  editing = false,
  onToggleSlot,
  onPaintSlots,
}) {
  const [focusIso, setFocusIso] = useState(null);
  const [mobileDay, setMobileDay] = useState(grid?.days?.[0]?.dateKey ?? null);
  const painting = useRef(null);
  const memberById = useMemo(() => {
    const map = new Map();
    for (const member of members) map.set(member.userId, member);
    return map;
  }, [members]);

  if (!grid) return null;
  const days = grid.days ?? [];
  const hours = grid.hours ?? [];
  const activeDay = days.find((day) => day.dateKey === mobileDay) ?? days[0];
  const focused = days.flatMap((day) => day.slots).find((slot) => slot.iso === focusIso) ?? null;
  const focusedUsers = (focused?.userIds ?? []).map((id) => memberById.get(id)).filter(Boolean);

  function slotState(slot) {
    const mine = editing ? selected.has(slot.iso) : slot.userIds.includes(myUserId);
    return { mine, count: slot.count, total: slot.memberCount };
  }

  function paintTo(iso, value) {
    if (!editing || !onPaintSlots || painting.current == null) return;
    onPaintSlots(iso, value);
  }

  return (
    <div className="space-y-3">
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        {timezoneHint(grid.timeZone)} · grade 08:00–23:00
      </p>

      <div className="md:hidden space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Dias da semana">
          {days.map((day) => {
            const selectedDay = day.dateKey === activeDay?.dateKey;
            return (
              <button
                key={day.dateKey}
                type="button"
                role="tab"
                aria-selected={selectedDay}
                onClick={() => setMobileDay(day.dateKey)}
                className="min-h-11 min-w-[4.5rem] px-3 rounded-xl text-caption font-bold cursor-pointer"
                style={{
                  backgroundColor: selectedDay ? 'var(--primary)' : 'var(--bg-subtle)',
                  color: selectedDay ? 'var(--text-on-primary)' : 'var(--text-main)',
                }}
              >
                {WEEKDAY_SHORT_PT[day.weekday] ?? day.weekday}
                <span className="block font-semibold">{String(day.day).padStart(2, '0')}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(activeDay?.slots ?? []).map((slot) => {
            const state = slotState(slot);
            return (
              <button
                key={slot.iso}
                type="button"
                aria-pressed={state.mine}
                aria-label={`${slot.label} ${state.count} de ${state.total} disponíveis`}
                onClick={() => {
                  setFocusIso(slot.iso);
                  if (editing) onToggleSlot?.(slot.iso);
                }}
                className="min-h-11 rounded-xl border px-3 text-left text-small font-semibold cursor-pointer"
                style={{
                  backgroundColor: intensityColor(state.count, state.total),
                  borderColor: state.mine ? 'var(--accent)' : 'var(--border-color)',
                  color: 'var(--text-main)',
                  boxShadow: state.mine ? 'inset 0 0 0 2px var(--accent)' : undefined,
                }}
              >
                {slot.label}
                <span className="block text-caption font-bold">
                  {state.count}/{state.total}
                  {state.mine ? ' · você' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="availability-grid min-w-full border-collapse text-caption">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 p-1 text-left" style={{ backgroundColor: 'var(--bg-surface)' }}>
                Hora
              </th>
              {days.map((day) => (
                <th key={day.dateKey} className="p-1 font-bold whitespace-nowrap">
                  {WEEKDAY_SHORT_PT[day.weekday] ?? day.weekday} {String(day.day).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour, hourIndex) => (
              <tr key={hour.label}>
                <th className="sticky left-0 z-10 p-1 text-left font-semibold" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  {hour.label}
                </th>
                {days.map((day) => {
                  const slot = day.slots[hourIndex];
                  const state = slotState(slot);
                  return (
                    <td key={`${day.dateKey}-${hour.label}`} className="p-0">
                      <button
                        type="button"
                        aria-pressed={state.mine}
                        aria-label={`${day.dateKey} ${slot.label}, ${state.count} de ${state.total}`}
                        onMouseDown={(event) => {
                          if (!editing) {
                            setFocusIso(slot.iso);
                            return;
                          }
                          event.preventDefault();
                          const next = !state.mine;
                          painting.current = next;
                          onToggleSlot?.(slot.iso, next);
                        }}
                        onMouseEnter={() => {
                          setFocusIso(slot.iso);
                          paintTo(slot.iso, painting.current);
                        }}
                        onMouseUp={() => {
                          painting.current = null;
                        }}
                        onClick={() => {
                          if (!editing) setFocusIso(slot.iso);
                        }}
                        className="block w-full min-h-8 cursor-pointer border"
                        style={{
                          backgroundColor: intensityColor(state.count, state.total),
                          borderColor: state.mine ? 'var(--accent)' : 'var(--border-color)',
                          boxShadow: state.mine ? 'inset 0 0 0 2px var(--accent)' : undefined,
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {focused ? (
        <div
          className="rounded-xl border p-3 space-y-1"
          style={{ backgroundColor: 'var(--bg-elevated, var(--bg-surface))', borderColor: 'var(--border-color)' }}
        >
          <p className="text-small font-bold">
            {focused.label}–{String(focused.hour + (focused.minute === 30 ? 1 : 0)).padStart(2, '0')}:
            {focused.minute === 0 ? '30' : '00'}
          </p>
          <p className="text-small">
            {focused.count} de {focused.memberCount} disponíveis
          </p>
          {focusedUsers.length === 0 ? (
            <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
              Ninguém marcou este horário.
            </p>
          ) : (
            <ul className="text-small space-y-0.5">
              {focusedUsers.map((member) => (
                <li key={member.userId}>
                  {memberDisplayName(member)}
                  {member.userId === myUserId ? ' (você)' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          Toque um horário para ver quem está disponível.
        </p>
      )}
    </div>
  );
}
