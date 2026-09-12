import React from 'react';
import MatchScoreEditor from './MatchScoreEditor.jsx';
import { resolveByeLabel, roundsInOrder } from './roundDisplay.js';

export default function RoundBoard({ session, canEditScores = false, onSaveScore, onClearScore }) {
  const rounds = roundsInOrder(session?.rounds);
  const teams = session?.teams ?? [];

  if (rounds.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-sm">Rodadas</h3>
      {rounds.map((round) => {
        const byeLabel = resolveByeLabel(teams, round.byeTeamId);
        return (
          <section
            key={round.id}
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <h4 className="font-bold text-sm">Rodada {round.number}</h4>
            {(round.matches ?? []).map((match) => (
              <MatchScoreEditor
                key={match.id}
                match={match}
                teams={teams}
                canEdit={canEditScores}
                onSave={(scoreA, scoreB) => onSaveScore?.(round.id, match.id, scoreA, scoreB)}
                onClear={(options) => onClearScore?.(round.id, match.id, options)}
              />
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
