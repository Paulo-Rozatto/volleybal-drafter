import React from 'react';
import MatchLineupEditor from './MatchLineupEditor.jsx';
import MatchScoreEditor from './MatchScoreEditor.jsx';
import { resolveByeLabel, roundsInOrder } from './roundDisplay.js';
import { resolveTeamSize } from './teamPresentation.js';

export default function RoundBoard({
  session,
  roster = [],
  canEditScores = false,
  canClearScores = false,
  canEditLineups = false,
  onSaveScore,
  onClearScore,
  onSaveLineups,
}) {
  const rounds = roundsInOrder(session?.rounds);
  const teams = session?.teams ?? [];
  const teamSize = resolveTeamSize(session);

  if (rounds.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-sm">Rodadas</h3>
      {rounds.map((round) => {
        const byeLabel = resolveByeLabel(teams, round.byeTeamId, { teamSize });
        return (
          <section
            key={round.id}
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <h4 className="font-bold text-sm">Rodada {round.number}</h4>
            {(round.matches ?? []).map((match) => (
              <div key={match.id} className="space-y-3">
                <MatchLineupEditor
                  match={match}
                  teams={teams}
                  roster={roster}
                  teamSize={teamSize}
                  canEdit={canEditLineups}
                  onSave={(lineupAPlayerIds, lineupBPlayerIds) =>
                    onSaveLineups?.(round.id, match.id, lineupAPlayerIds, lineupBPlayerIds)
                  }
                />
                <MatchScoreEditor
                  match={match}
                  teams={teams}
                  teamSize={teamSize}
                  canEdit={canEditScores}
                  canClear={canClearScores}
                  onSave={(scoreA, scoreB) => onSaveScore?.(round.id, match.id, scoreA, scoreB)}
                  onClear={(options) => onClearScore?.(round.id, match.id, options)}
                />
              </div>
            ))}
            {byeLabel && (
              <p className="text-xs font-semibold break-words" style={{ color: 'var(--text-muted)' }}>
                Folga: {byeLabel}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
