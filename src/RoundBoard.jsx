import React from 'react';
import MatchLineupEditor from './MatchLineupEditor.jsx';
import MatchScoreEditor from './MatchScoreEditor.jsx';
import { cyclesInOrder, idleTeamIds, resolveTeamLabel } from './roundDisplay.js';
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
  const cycles = cyclesInOrder(session?.rounds);
  const teams = session?.teams ?? [];
  const teamSize = resolveTeamSize(session);
  const usesBlocks = Number.isInteger(session?.courtCount) && session.courtCount >= 1;
  const showCycleHeadings =
    cycles.length > 1 ||
    (session?.rounds ?? []).some((round) => Object.prototype.hasOwnProperty.call(round ?? {}, 'cycleNumber'));

  if (cycles.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-sm">{usesBlocks ? 'Blocos' : 'Rodadas'}</h3>
      {cycles.map((cycle) => (
        <section key={cycle.cycleNumber} className="space-y-3">
          {showCycleHeadings && <h4 className="font-bold text-sm">Ciclo {cycle.cycleNumber}</h4>}
          {cycle.rounds.map((round) => {
            const idleLabels = idleTeamIds(teams, round)
              .map((teamId) => resolveTeamLabel(teams, teamId, { teamSize }))
              .filter(Boolean);
            return (
              <section
                key={round.id}
                className="p-4 rounded-xl border space-y-3"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <h5 className="font-bold text-sm">
                  {usesBlocks ? `Bloco ${round.number}` : `Rodada ${round.number}`}
                </h5>
                {(round.matches ?? []).map((match, matchIndex) => (
                  <div key={match.id} className="space-y-3">
                    {usesBlocks && (
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        Quadra {matchIndex + 1}
                      </p>
                    )}
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
                {idleLabels.length > 0 && (
                  <p className="text-xs font-semibold break-words" style={{ color: 'var(--text-muted)' }}>
                    Folga: {idleLabels.join(' · ')}
                  </p>
                )}
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
}
