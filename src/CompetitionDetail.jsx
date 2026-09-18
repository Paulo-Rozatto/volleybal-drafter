import React, { useRef, useState } from 'react';
import CompetitionBracket from './CompetitionBracket.jsx';
import CompetitionMatchEditor from './CompetitionMatchEditor.jsx';
import CompetitionTeamBuilder from './CompetitionTeamBuilder.jsx';
import {
  addCompetitionTeam,
  clearCompetitionMatchScore,
  generateCompetitionBracket,
  moveCompetitionTeam,
  removeCompetitionTeam,
  setCompetitionMatchScore,
  updateCompetitionTeam,
} from './competitions.js';
import {
  canGenerateCompetitionBracket,
  competitionChampionView,
  competitionDateValue,
  competitionDisplayName,
  competitionListItem,
  competitionStageViews,
  generateCompetitionBlockedReason,
  generateCompetitionButtonLabel,
  seedTeamIdsFromTeams,
  shouldShowGenerateCompetitionButton,
} from './competitionPresentation.js';
import { formatSessionDate } from './teamGameSessions.js';

export default function CompetitionDetail({
  competition,
  players = [],
  syncPanel,
  onBack,
  onApplyOperation,
}) {
  const [openSlot, setOpenSlot] = useState(null);
  const [generateError, setGenerateError] = useState(null);
  const matchOpenerRef = useRef(null);
  const summary = competitionListItem(competition);
  const champion = competitionChampionView(competition);
  const canGenerate = canGenerateCompetitionBracket(competition);
  const blockedReason = generateCompetitionBlockedReason(competition);
  const showGenerate = shouldShowGenerateCompetitionButton(competition);
  const generateLabel = generateCompetitionButtonLabel(competition);
  const stageViews = competitionStageViews(competition);

  const applyTeams = (operation) =>
    onApplyOperation?.((current) => operation(current, competition.id));

  const handleGenerate = () => {
    setGenerateError(null);
    const result = onApplyOperation?.((current) =>
      generateCompetitionBracket(current, competition.id, {
        seedTeamIds: seedTeamIdsFromTeams(competition.teams),
      })
    );
    if (!result?.ok) {
      setGenerateError(result?.errors?.[0]?.message || 'Não foi possível gerar a chave.');
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="font-bold text-sm py-2 cursor-pointer"
        style={{ color: 'var(--primary)' }}
      >
        ← Voltar para competições
      </button>

      <div
        className="p-4 rounded-xl border space-y-1"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h2 className="text-xl font-bold">{competitionDisplayName(competition)}</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatSessionDate(competitionDateValue(competition))} · {summary.formatLabel} · {summary.statusLabel}
        </p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {summary.teamCountLabel} · {summary.phaseLabel}
        </p>
      </div>

      {syncPanel}

      {champion && (
        <section
          aria-label="Campeão"
          className="p-4 rounded-xl border space-y-1"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--primary)',
          }}
        >
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
            🏆 {champion.heading}
          </p>
          <p className="text-lg font-extrabold">{champion.teamLabel}</p>
          {champion.memberNames.length > 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {champion.memberNames.join(', ')}
            </p>
          )}
          <p className="text-sm font-bold">
            {champion.finalRoundName}: {champion.scoreLabel}
          </p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-bold">Times e seeding</h3>
        <CompetitionTeamBuilder
          competition={competition}
          roster={players}
          onAddTeam={(memberIds) =>
            applyTeams((current, competitionId) =>
              addCompetitionTeam(current, competitionId, memberIds, { roster: players })
            )
          }
          onUpdateTeam={(teamId, memberIds) =>
            applyTeams((current, competitionId) =>
              updateCompetitionTeam(current, competitionId, teamId, memberIds, { roster: players })
            )
          }
          onRemoveTeam={(teamId) =>
            applyTeams((current, competitionId) =>
              removeCompetitionTeam(current, competitionId, teamId)
            )
          }
          onMoveTeam={(teamId, delta) =>
            applyTeams((current, competitionId) =>
              moveCompetitionTeam(current, competitionId, teamId, delta)
            )
          }
        />
      </section>

      {showGenerate && (
        <div className="space-y-2">
          {blockedReason && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {blockedReason}
            </p>
          )}
          {generateError && <p className="text-xs font-semibold text-red-500">{generateError}</p>}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
          >
            {generateLabel}
          </button>
        </div>
      )}

      {stageViews.map((stage, stageIndex) => (
        <section key={stage.id} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold">
              Fase {stage.number}: {stage.name}
            </h3>
            <span
              className="text-xs font-semibold px-2 py-1 rounded-lg"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
            >
              {stage.statusLabel}
            </span>
          </div>

          {stage.standings.length > 0 && (
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
              <table className="w-full text-sm">
                <caption className="sr-only">Classificação suíça</caption>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                    <th className="text-left font-bold p-2">#</th>
                    <th className="text-left font-bold p-2">Time</th>
                    <th className="text-right font-bold p-2">J</th>
                    <th className="text-right font-bold p-2">V</th>
                    <th className="text-right font-bold p-2">D</th>
                    <th className="text-right font-bold p-2">BYE</th>
                    <th className="text-right font-bold p-2">PF</th>
                    <th className="text-right font-bold p-2">PS</th>
                    <th className="text-right font-bold p-2">Saldo</th>
                    <th className="text-right font-bold p-2">Buchholz</th>
                  </tr>
                </thead>
                <tbody>
                  {stage.standings.map((row) => (
                    <tr key={row.teamId} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td className="p-2 font-bold">{row.position}</td>
                      <td className="p-2">{row.teamLabel}</td>
                      <td className="p-2 text-right tabular-nums">{row.played}</td>
                      <td className="p-2 text-right tabular-nums">{row.wins}</td>
                      <td className="p-2 text-right tabular-nums">{row.losses}</td>
                      <td className="p-2 text-right tabular-nums">{row.byes}</td>
                      <td className="p-2 text-right tabular-nums">{row.pointsFor}</td>
                      <td className="p-2 text-right tabular-nums">{row.pointsAgainst}</td>
                      <td className="p-2 text-right tabular-nums">{row.pointDifference}</td>
                      <td className="p-2 text-right tabular-nums">{row.buchholz}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stage.hasRounds ? (
            <CompetitionBracket
              competition={competition}
              stage={competition.stages[stageIndex]}
              showChampion={stageIndex === stageViews.length - 1 && Boolean(champion)}
              onOpenMatch={(slot) => {
                matchOpenerRef.current = document.activeElement;
                setOpenSlot(slot);
              }}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Esta fase ainda não foi gerada.
            </p>
          )}
        </section>
      ))}

      {openSlot && (
        <CompetitionMatchEditor
          competition={competition}
          slot={openSlot}
          openerRef={matchOpenerRef}
          onSave={({ scoreA, scoreB, playedDate, downstreamConfirmed }) =>
            onApplyOperation?.((current) =>
              setCompetitionMatchScore(
                current,
                competition.id,
                openSlot.id,
                { scoreA, scoreB, playedDate },
                { downstreamConfirmed }
              )
            )
          }
          onClear={(options) =>
            onApplyOperation?.((current) =>
              clearCompetitionMatchScore(current, competition.id, openSlot.id, options)
            )
          }
          onClose={() => setOpenSlot(null)}
        />
      )}
    </div>
  );
}
