import React from 'react';
import {
  COMPETITION_BYE_HINT,
  COMPETITION_BYE_LABEL,
  COMPETITION_UNRESOLVED_MATCH_HINT,
  COMPETITION_WINNER_LABEL,
} from './competitionPresentation.js';

function SideRow({ side }) {
  return (
    <div className="min-w-0">
      <p
        className="text-sm break-words leading-snug"
        style={{
          color: 'var(--text-main)',
          fontWeight: side?.winner ? 800 : 600,
        }}
      >
        {side?.label}
      </p>
      {side?.winner && (
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
          🏆 {COMPETITION_WINNER_LABEL}
        </p>
      )}
    </div>
  );
}

export default function CompetitionMatchCard({ slot, onOpen }) {
  if (!slot) return null;

  if (slot.type === 'bye') {
    return (
      <article
        data-slot-id={slot.id}
        aria-label={`${COMPETITION_BYE_LABEL}: ${slot.teamLabel}. ${COMPETITION_BYE_HINT}`}
        className="w-full min-h-[6.5rem] rounded-xl border border-dashed p-3 space-y-1"
        style={{
          backgroundColor: 'var(--bg-app)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-main)',
        }}
      >
        <p
          className="text-[10px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--text-muted)' }}
        >
          {COMPETITION_BYE_LABEL}
        </p>
        <p className="text-sm font-semibold break-words">{slot.teamLabel}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {COMPETITION_BYE_HINT}
        </p>
      </article>
    );
  }

  if (slot.type === 'champion') {
    return (
      <article
        data-slot-id={slot.id}
        aria-label={`Campeão: ${slot.teamLabel}`}
        className="w-full min-h-[6.5rem] rounded-xl border p-3 space-y-1"
        style={{
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--primary)',
          color: 'var(--text-main)',
        }}
      >
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
          🏆 {slot.heading}
        </p>
        <p className="text-sm font-extrabold break-words">{slot.teamLabel}</p>
        {slot.memberNames?.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {slot.memberNames.join(', ')}
          </p>
        )}
        {slot.scoreLabel && (
          <p className="text-xs font-bold">{slot.scoreLabel}</p>
        )}
      </article>
    );
  }

  const playable = Boolean(slot.playable);
  const label = playable
    ? `${slot.roundName}: ${slot.sideA.label} ${slot.scoreLabel} ${slot.sideB.label}`
    : `${slot.roundName}: ${COMPETITION_UNRESOLVED_MATCH_HINT}`;

  return (
    <button
      type="button"
      data-slot-id={slot.id}
      onClick={() => playable && onOpen?.(slot)}
      disabled={!playable}
      aria-disabled={!playable}
      aria-label={label}
      title={playable ? 'Abrir resultado' : COMPETITION_UNRESOLVED_MATCH_HINT}
      className="w-full min-h-[6.5rem] text-left rounded-xl border p-3 space-y-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus-visible:ring-2"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: slot.completed ? 'var(--primary)' : 'var(--border-color)',
        color: 'var(--text-main)',
        boxShadow: slot.completed ? 'inset 0 0 0 1px var(--primary)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <SideRow side={slot.sideA} />
        <p className="shrink-0 text-sm font-black tabular-nums" aria-hidden="true">
          {slot.completed ? slot.match?.scoreA : '—'}
        </p>
      </div>
      <div className="flex items-start justify-between gap-2">
        <SideRow side={slot.sideB} />
        <p className="shrink-0 text-sm font-black tabular-nums" aria-hidden="true">
          {slot.completed ? slot.match?.scoreB : '—'}
        </p>
      </div>
      {!playable && (
        <p className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          {COMPETITION_UNRESOLVED_MATCH_HINT}
        </p>
      )}
    </button>
  );
}
