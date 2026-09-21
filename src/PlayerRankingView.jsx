import React, { useMemo, useState } from 'react';
import {
  buildPlayerPerformanceIndex,
  getPlayerPerformanceRanking,
  listPerformanceModalities,
  listPerformancePlayers,
} from './domain/playerPerformance.js';
import {
  HISTORICAL_PLAYER_LABEL,
  RANKING_INTRO,
  RANKING_PLAYER_FILTER_NOTE,
  filterPlayersBySearch,
  formatHistoryDiagnostics,
  formatPointDifference,
  formatPointsAverage,
  formatWinRatePercent,
  modalityFilterOptions,
  rankingSortOptions,
  rankingSourceFilterOptions,
  resolveRankingPlayerIds,
} from './performancePresentation.js';

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

export default function PlayerRankingView({ document, roster = [], competitionsDocument = null }) {
  const built = useMemo(
    () => buildPlayerPerformanceIndex(document, roster, { competitionsDocument }),
    [document, roster, competitionsDocument]
  );
  const players = useMemo(
    () => (built.ok ? listPerformancePlayers(built.index) : []),
    [built]
  );

  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [lineupSize, setLineupSize] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortBy, setSortBy] = useState('wins');
  const [sortDirection, setSortDirection] = useState('desc');

  const visiblePlayers = filterPlayersBySearch(players, search);
  const sortOptions = rankingSortOptions();
  const sourceOptions = rankingSourceFilterOptions();
  const modalityOptions = modalityFilterOptions(built.ok ? listPerformanceModalities(built.index) : []);

  const rows = useMemo(() => {
    if (!built.ok) return [];
    return getPlayerPerformanceRanking(built.index, {
      startDate: startDate || null,
      endDate: endDate || null,
      sourceType: sourceType || null,
      lineupSize,
      playerIds: resolveRankingPlayerIds(selectedIds, players),
      sortBy,
      sortDirection,
    });
  }, [built, startDate, endDate, sourceType, lineupSize, selectedIds, players, sortBy, sortDirection]);

  const diagnostics = built.ok ? formatHistoryDiagnostics(built.index) : null;

  const togglePlayer = (playerId) => {
    setSelectedIds((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId]
    );
  };

  if (!built.ok) {
    return (
      <section className="space-y-3" aria-labelledby="ranking-title">
        <h2 id="ranking-title" className="text-xl font-bold">
          Ranking de jogadores
        </h2>
        <div role="alert" className="rounded-xl border p-4 space-y-2" style={surfaceStyle}>
          <p className="font-bold">Não foi possível calcular o ranking.</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {(built.errors ?? []).map((item, index) => (
              <li key={`${item.code}-${index}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="ranking-title">
      <div className="space-y-1">
        <h2 id="ranking-title" className="text-xl font-bold">
          Ranking de jogadores
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {RANKING_INTRO}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border p-3" style={surfaceStyle}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-bold" htmlFor="ranking-start-date">
              Data inicial
            </label>
            <input
              id="ranking-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={`mt-1 w-full border rounded-lg p-2 text-sm ${focusClass}`}
              style={controlStyle}
            />
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="ranking-end-date">
              Data final
            </label>
            <input
              id="ranking-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={`mt-1 w-full border rounded-lg p-2 text-sm ${focusClass}`}
              style={controlStyle}
            />
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="ranking-source">
              Origem
            </label>
            <select
              id="ranking-source"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value)}
              className={`mt-1 w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
              style={controlStyle}
            >
              {sourceOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="ranking-modality">
              Modalidade
            </label>
            <select
              id="ranking-modality"
              value={lineupSize == null ? '' : String(lineupSize)}
              onChange={(event) =>
                setLineupSize(event.target.value === '' ? null : Number(event.target.value))
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-bold" htmlFor="ranking-sort">
              Ordenar por
            </label>
            <select
              id="ranking-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className={`mt-1 w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
              style={controlStyle}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="ranking-direction">
              Direção
            </label>
            <select
              id="ranking-direction"
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value)}
              className={`mt-1 w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
              style={controlStyle}
            >
              <option value="desc">Maior para menor</option>
              <option value="asc">Menor para maior</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold" htmlFor="ranking-player-search">
            Filtrar jogadores
          </label>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {RANKING_PLAYER_FILTER_NOTE}
          </p>
          <input
            id="ranking-player-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome do jogador"
            className={`mt-2 w-full border rounded-lg p-2 text-sm ${focusClass}`}
            style={controlStyle}
          />
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className={`mt-2 text-sm font-bold underline cursor-pointer ${focusClass}`}
              style={{ color: 'var(--primary)' }}
            >
              Mostrar todos os jogadores
            </button>
          )}
          {visiblePlayers.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhum jogador encontrado para esta busca.
            </p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {visiblePlayers.map((player) => {
                const checked = selectedIds.includes(player.playerId);
                return (
                  <li key={player.playerId}>
                    <label className="flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePlayer(player.playerId)}
                      />
                      <span className="font-semibold">{player.playerName}</span>
                      {!player.isCurrentRosterPlayer && (
                        <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                          {HISTORICAL_PLAYER_LABEL}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          Nenhum jogador disponível para o ranking.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={surfaceStyle}>
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Ranking de jogadores</caption>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <th className="text-left px-3 py-2 font-bold">#</th>
                <th className="text-left px-3 py-2 font-bold">Jogador</th>
                <th className="text-right px-3 py-2 font-bold">Jogos</th>
                <th className="text-right px-3 py-2 font-bold">Vitórias</th>
                <th className="text-right px-3 py-2 font-bold">Derrotas</th>
                <th className="text-right px-3 py-2 font-bold">Aproveitamento</th>
                <th className="text-right px-3 py-2 font-bold">Pontos feitos</th>
                <th className="text-right px-3 py-2 font-bold">Média feitos</th>
                <th className="text-right px-3 py-2 font-bold">Pontos sofridos</th>
                <th className="text-right px-3 py-2 font-bold">Média sofridos</th>
                <th className="text-right px-3 py-2 font-bold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.playerId} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="px-3 py-2 font-semibold">{index + 1}</td>
                  <th className="text-left px-3 py-2 font-semibold" scope="row">
                    {row.playerName}
                  </th>
                  <td className="text-right px-3 py-2">{row.matches}</td>
                  <td className="text-right px-3 py-2">{row.wins}</td>
                  <td className="text-right px-3 py-2">{row.losses}</td>
                  <td className="text-right px-3 py-2">
                    {formatWinRatePercent(row.winRate, row.matches)}
                  </td>
                  <td className="text-right px-3 py-2">{row.pointsFor}</td>
                  <td className="text-right px-3 py-2">{formatPointsAverage(row.averagePointsFor)}</td>
                  <td className="text-right px-3 py-2">{row.pointsAgainst}</td>
                  <td className="text-right px-3 py-2">{formatPointsAverage(row.averagePointsAgainst)}</td>
                  <td className="text-right px-3 py-2">
                    {formatPointDifference(row.pointDifference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {diagnostics && (
        <aside
          className="rounded-xl border p-3 space-y-1 text-xs"
          style={{ ...surfaceStyle, color: 'var(--text-muted)' }}
        >
          <p className="font-bold" style={{ color: 'var(--text-main)' }}>
            Diagnóstico do histórico
          </p>
          <p>
            {diagnostics.includedLabel} · {diagnostics.pendingLabel} · {diagnostics.invalidLabel}
          </p>
        </aside>
      )}
    </section>
  );
}
