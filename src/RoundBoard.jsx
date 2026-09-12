import React from 'react';
import { resolveByeLabel, resolvePairLabel, roundsInOrder } from './roundDisplay.js';

export default function RoundBoard({ session }) {
  const rounds = roundsInOrder(session?.rounds);
  const pairs = session?.pairs ?? [];

  if (rounds.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-sm">Rodadas</h3>
      {rounds.map((round) => {
        const byeLabel = resolveByeLabel(pairs, round.byePairId);
        return (
          <section
            key={round.id}
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <h4 className="font-bold text-sm">Rodada {round.number}</h4>
            {(round.matches ?? []).map((match) => (
              <div
                key={match.id}
                className="rounded-xl border p-3 space-y-1"
                style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
              >
                <p className="text-sm font-semibold">{resolvePairLabel(pairs, match.pairAId)}</p>
                <p className="text-sm font-bold text-center" style={{ color: 'var(--text-muted)' }}>
                  — × —
                </p>
                <p className="text-sm font-semibold text-right">{resolvePairLabel(pairs, match.pairBId)}</p>
              </div>
            ))}
            {byeLabel && (
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Folga: {byeLabel}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
