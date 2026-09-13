import React, { useMemo, useState } from 'react';
import {
  buildPlayerPerformanceIndex,
  getCohortPartnershipMatrix,
  getCohortPartnershipPerformance,
  getCohortPlayerPerformances,
  listCohortModalities,
  listCohortPlayers,
  listSessionParticipants,
} from './domain/playerPerformance.js';
import { HISTORICAL_PLAYER_LABEL } from './performancePresentation.js';
import {
  SESSION_COHORT_NOTE,
  SESSION_DIAGNOSTICS_TITLE,
  SESSION_DIAGONAL_CELL,
  SESSION_EMPTY_PLAYERS_MESSAGE,
  SESSION_INDIVIDUAL_INTRO,
  SESSION_INDIVIDUAL_TITLE,
  SESSION_MATRIX_TITLE,
  formatPartnershipCellLabel,
  formatPartnershipTitle,
  formatPointDifference,
  formatSessionDiagnostics,
  formatTogetherModalities,
  formatWinRatePercent,
  formatZeroPartnershipMessage,
  matrixMaxMatches,
  normalizePartnershipSelection,
  partnershipCellHeat,
  partnershipSelectionEquals,
  playerNameById,
  resolveSessionModalityFilter,
  sessionModalityOptions,
} from './sessionPerformancePresentation.js';

const surfaceStyle = {
  backgroundColor: 'var(--bg-surface)',
  borderColor: 'var(--border-color)',
  color: 'var(--text-main)',
};

const controlStyle = {
  backgroundColor: 'var(--bg-app)',
  color: 'var(--text-main)',
  borderColor: 'var(--border-color)',
};

const focusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
const EMPTY_PARTICIPANT_IDS = Object.freeze([]);

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border p-3" style={surfaceStyle}>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function cellBackground(matches, maxMatches, selected) {
  if (selected) {
    return 'color-mix(in srgb, var(--primary) 28%, var(--bg-surface))';
  }
  const heat = partnershipCellHeat(matches, maxMatches);
  if (heat <= 0) return 'var(--bg-surface)';
  return `color-mix(in srgb, var(--primary) ${Math.round(12 + heat * 28)}%, var(--bg-surface))`;
}

export default function SessionPerformanceView({ document, roster = [], sessionId }) {
  const built = useMemo(
    () => buildPlayerPerformanceIndex(document, roster),
    [document, roster]
  );
  const cohort = useMemo(
    () => listSessionParticipants(document, roster, sessionId),
    [document, roster, sessionId]
  );

  const [lineupSizeState, setLineupSizeState] = useState(null);
  const [highlightedPlayerId, setHighlightedPlayerId] = useState(null);
  const [partnership, setPartnership] = useState(null);
  const [mobileLeftId, setMobileLeftId] = useState('');
  const [mobileRightId, setMobileRightId] = useState('');

  const participantIds = cohort.ok ? cohort.participantIds : EMPTY_PARTICIPANT_IDS;
  const listedPlayers = useMemo(
    () => (built.ok && cohort.ok ? listCohortPlayers(built.index, participantIds) : []),
    [built, cohort.ok, participantIds]
  );
  const modalities = useMemo(
    () => (built.ok && cohort.ok ? listCohortModalities(built.index, participantIds) : []),
    [built, cohort.ok, participantIds]
  );
  const lineupSize = resolveSessionModalityFilter(lineupSizeState, modalities);
  const modalityOptions = sessionModalityOptions(modalities);

  const playerRows = useMemo(() => {
    if (!built.ok || !cohort.ok) return [];
    return getCohortPlayerPerformances(built.index, participantIds, { lineupSize });
  }, [built, cohort.ok, participantIds, lineupSize]);

  const matrix = useMemo(() => {
    if (!built.ok || !cohort.ok) return null;
    return getCohortPartnershipMatrix(built.index, participantIds, { lineupSize });
  }, [built, cohort.ok, participantIds, lineupSize]);

  const pairStats = useMemo(() => {
    if (!built.ok || !partnership) return null;
    return getCohortPartnershipPerformance(
      built.index,
      partnership.left,
      partnership.right,
      { lineupSize }
    );
  }, [built, partnership, lineupSize]);

  const maxMatches = matrixMaxMatches(matrix);
  const diagnostics = built.ok ? formatSessionDiagnostics(built.index) : null;
  const leftName = playerNameById(listedPlayers, partnership?.left);
  const rightName = playerNameById(listedPlayers, partnership?.right);

  const selectPartnership = (playerId, partnerId) => {
    const next = normalizePartnershipSelection(playerId, partnerId);
    setPartnership(next);
    if (next) {
      setMobileLeftId(next.left);
      setMobileRightId(next.right);
    }
  };

  const clearPartnership = () => {
    setPartnership(null);
  };

  const applyMobilePair = (leftId, rightId) => {
    setMobileLeftId(leftId);
    setMobileRightId(rightId);
    const next = normalizePartnershipSelection(leftId, rightId);
    setPartnership(next);
  };

  if (!built.ok || !cohort.ok) {
    return (
      <section className="space-y-3" aria-labelledby="session-performance-title">
        <h3 id="session-performance-title" className="text-lg font-bold">
          {SESSION_INDIVIDUAL_TITLE}
        </h3>
        <div role="alert" className="rounded-xl border p-4 space-y-2" style={surfaceStyle}>
          <p className="font-bold">Não foi possível calcular o histórico dos participantes.</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {(cohort.ok ? built.errors : cohort.errors ?? built.errors ?? []).map((item, index) => (
              <li key={`${item.code}-${index}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  if (listedPlayers.length === 0) {
    return (
      <section className="space-y-3" aria-labelledby="session-performance-title">
        <h3 id="session-performance-title" className="text-lg font-bold">
          {SESSION_INDIVIDUAL_TITLE}
        </h3>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          {SESSION_EMPTY_PLAYERS_MESSAGE}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="session-performance-title">
      <div className="space-y-1">
        <h3 id="session-performance-title" className="text-lg font-bold">
          {SESSION_INDIVIDUAL_TITLE}
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {SESSION_INDIVIDUAL_INTRO}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {SESSION_COHORT_NOTE}
        </p>
        <div>
          <label className="block text-sm font-bold" htmlFor="session-performance-modality">
            Modalidade
          </label>
          <select
            id="session-performance-modality"
            value={lineupSize == null ? '' : String(lineupSize)}
            onChange={(event) =>
              setLineupSizeState(event.target.value === '' ? null : Number(event.target.value))
            }
            className={`mt-1 w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
            style={controlStyle}
          >
            {modalityOptions.map((option) => (
              <option
                key={option.value == null ? 'all' : option.value}
                value={option.value == null ? '' : String(option.value)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {playerRows.map((player) => {
          const selected = player.playerId === highlightedPlayerId;
          return (
            <button
              key={player.playerId}
              type="button"
              onClick={() =>
                setHighlightedPlayerId((current) =>
                  current === player.playerId ? null : player.playerId
                )
              }
              className={`w-full text-left rounded-xl border p-3 space-y-2 cursor-pointer ${focusClass}`}
              style={{
                ...surfaceStyle,
                borderColor: selected ? 'var(--primary)' : 'var(--border-color)',
                borderWidth: selected ? 2 : 1,
              }}
            >
              <p className="font-bold">
                {player.playerName}
                {!player.isCurrentRosterPlayer ? ` · ${HISTORICAL_PLAYER_LABEL}` : ''}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {player.matches} {player.matches === 1 ? 'jogo' : 'jogos'} · {player.wins}{' '}
                {player.wins === 1 ? 'vitória' : 'vitórias'} · {player.losses}{' '}
                {player.losses === 1 ? 'derrota' : 'derrotas'} ·{' '}
                {formatWinRatePercent(player.winRate, player.matches)}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {player.pointsFor} pró · {player.pointsAgainst} contra · saldo{' '}
                {formatPointDifference(player.pointDifference)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl border" style={surfaceStyle}>
        <table className="w-full text-sm">
          <caption className="sr-only">{SESSION_INDIVIDUAL_TITLE}</caption>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <th className="text-left px-3 py-2 font-bold">Jogador</th>
              <th className="text-right px-3 py-2 font-bold">Jogos</th>
              <th className="text-right px-3 py-2 font-bold">Vitórias</th>
              <th className="text-right px-3 py-2 font-bold">Derrotas</th>
              <th className="text-right px-3 py-2 font-bold">Aproveitamento</th>
              <th className="text-right px-3 py-2 font-bold">Pontos pró</th>
              <th className="text-right px-3 py-2 font-bold">Pontos contra</th>
              <th className="text-right px-3 py-2 font-bold">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {playerRows.map((player) => {
              const selected = player.playerId === highlightedPlayerId;
              return (
                <tr
                  key={player.playerId}
                  style={{
                    backgroundColor: selected
                      ? 'color-mix(in srgb, var(--primary) 16%, var(--bg-surface))'
                      : 'transparent',
                  }}
                >
                  <th className="text-left px-3 py-2 font-semibold" scope="row">
                    <button
                      type="button"
                      onClick={() =>
                        setHighlightedPlayerId((current) =>
                          current === player.playerId ? null : player.playerId
                        )
                      }
                      className={`text-left cursor-pointer ${focusClass}`}
                      aria-pressed={selected}
                    >
                      {player.playerName}
                      {!player.isCurrentRosterPlayer ? (
                        <span className="ml-2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                          {HISTORICAL_PLAYER_LABEL}
                        </span>
                      ) : null}
                    </button>
                  </th>
                  <td className="text-right px-3 py-2">{player.matches}</td>
                  <td className="text-right px-3 py-2">{player.wins}</td>
                  <td className="text-right px-3 py-2">{player.losses}</td>
                  <td className="text-right px-3 py-2">
                    {formatWinRatePercent(player.winRate, player.matches)}
                  </td>
                  <td className="text-right px-3 py-2">{player.pointsFor}</td>
                  <td className="text-right px-3 py-2">{player.pointsAgainst}</td>
                  <td className="text-right px-3 py-2">
                    {formatPointDifference(player.pointDifference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-bold">{SESSION_MATRIX_TITLE}</h3>

        <div className="space-y-3 rounded-xl border p-3 md:hidden" style={surfaceStyle}>
          <p className="text-sm font-bold">Consultar um par</p>
          <div className="space-y-2">
            <label className="block text-sm font-bold" htmlFor="session-pair-left">
              Primeiro jogador
            </label>
            <select
              id="session-pair-left"
              value={mobileLeftId}
              onChange={(event) => applyMobilePair(event.target.value, mobileRightId)}
              className={`w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
              style={controlStyle}
            >
              <option value="">Selecionar</option>
              {listedPlayers.map((player) => (
                <option key={player.playerId} value={player.playerId}>
                  {player.playerName}
                </option>
              ))}
            </select>
            <label className="block text-sm font-bold" htmlFor="session-pair-right">
              Segundo jogador
            </label>
            <select
              id="session-pair-right"
              value={mobileRightId}
              onChange={(event) => applyMobilePair(mobileLeftId, event.target.value)}
              className={`w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
              style={controlStyle}
            >
              <option value="">Selecionar</option>
              {listedPlayers.map((player) => (
                <option key={player.playerId} value={player.playerId}>
                  {player.playerName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {matrix && (
          <div
            className="max-h-[70vh] overflow-auto rounded-xl border"
            style={surfaceStyle}
            tabIndex={0}
            aria-label={SESSION_MATRIX_TITLE}
          >
            <table className="border-collapse text-sm">
              <caption className="sr-only">{SESSION_MATRIX_TITLE}</caption>
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-20 min-w-[7rem] px-2 py-2 text-left font-bold"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    Jogador
                  </th>
                  {matrix.players.map((player) => (
                    <th
                      key={player.playerId}
                      className="sticky top-0 z-10 min-w-[2.75rem] px-2 py-2 text-center font-bold"
                      style={{
                        backgroundColor:
                          player.playerId === highlightedPlayerId
                            ? 'color-mix(in srgb, var(--primary) 16%, var(--bg-subtle))'
                            : 'var(--bg-subtle)',
                      }}
                    >
                      <span className="block max-w-[4.5rem] truncate">{player.playerName}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.playerId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 min-w-[7rem] max-w-[9rem] truncate px-2 py-2 text-left font-semibold"
                      style={{
                        backgroundColor:
                          row.playerId === highlightedPlayerId
                            ? 'color-mix(in srgb, var(--primary) 16%, var(--bg-surface))'
                            : 'var(--bg-surface)',
                      }}
                    >
                      {row.playerName}
                    </th>
                    {row.cells.map((cell) => {
                      if (cell.diagonal) {
                        return (
                          <td
                            key={`${cell.playerId}:${cell.partnerId}`}
                            className="px-2 py-2 text-center"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <span aria-label={formatPartnershipCellLabel(row.playerName, row.playerName, null)}>
                              {SESSION_DIAGONAL_CELL}
                            </span>
                          </td>
                        );
                      }
                      const partnerName = playerNameById(matrix.players, cell.partnerId);
                      const selected = partnershipSelectionEquals(
                        partnership,
                        cell.playerId,
                        cell.partnerId
                      );
                      const highlighted =
                        cell.playerId === highlightedPlayerId ||
                        cell.partnerId === highlightedPlayerId;
                      return (
                        <td key={`${cell.playerId}:${cell.partnerId}`} className="p-0 text-center">
                          <button
                            type="button"
                            aria-label={formatPartnershipCellLabel(
                              row.playerName,
                              partnerName,
                              cell.matches
                            )}
                            aria-pressed={selected}
                            onClick={() => selectPartnership(cell.playerId, cell.partnerId)}
                            className={`min-h-11 min-w-[2.75rem] w-full px-2 py-2 font-bold cursor-pointer ${focusClass}`}
                            style={{
                              backgroundColor: cellBackground(cell.matches, maxMatches, selected),
                              color: 'var(--text-main)',
                              boxShadow: highlighted && !selected ? 'inset 0 0 0 1px var(--primary)' : 'none',
                            }}
                          >
                            {cell.matches}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {partnership && pairStats && (
        <div className="rounded-xl border p-4 space-y-3" style={surfaceStyle} aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-base font-bold">{formatPartnershipTitle(leftName, rightName)}</h4>
            <button
              type="button"
              onClick={clearPartnership}
              className={`shrink-0 text-sm font-bold underline cursor-pointer ${focusClass}`}
              style={{ color: 'var(--primary)' }}
            >
              Limpar seleção
            </button>
          </div>
          {pairStats.matches === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {formatZeroPartnershipMessage(leftName, rightName)}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <StatCard label="Jogos juntos" value={pairStats.matches} />
            <StatCard label="Vitórias" value={pairStats.wins} />
            <StatCard label="Derrotas" value={pairStats.losses} />
            <StatCard
              label="Aproveitamento"
              value={formatWinRatePercent(pairStats.winRate, pairStats.matches)}
            />
            <StatCard label="Pontos pró" value={pairStats.pointsFor} />
            <StatCard label="Pontos contra" value={pairStats.pointsAgainst} />
            <StatCard
              label="Saldo"
              value={formatPointDifference(pairStats.pointDifference)}
            />
          </div>
          <p className="text-sm">
            <span className="font-bold">Modalidades: </span>
            {formatTogetherModalities(pairStats.modalities)}
          </p>
        </div>
      )}

      {diagnostics && (
        <div className="rounded-xl border p-4 space-y-1" style={surfaceStyle}>
          <p className="text-sm font-bold">{SESSION_DIAGNOSTICS_TITLE}</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {diagnostics.includedLabel}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {diagnostics.pendingLabel}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {diagnostics.invalidLabel}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {diagnostics.cohortNote}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {diagnostics.partnershipNote}
          </p>
          {diagnostics.invalidWarning && (
            <p className="text-sm font-semibold" role="status">
              {diagnostics.invalidWarning}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
