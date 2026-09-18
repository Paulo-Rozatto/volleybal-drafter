import React, { useMemo, useState } from 'react';
import {
  buildPlayerPerformanceIndex,
  formatPerformanceModality,
  getBestPartner,
  getPlayerPartnerMatchHistory,
  getPlayerPartnerPerformance,
  getPlayerPerformance,
  listPerformancePlayers,
} from './domain/playerPerformance.js';
import {
  ALL_PARTNERS_LABEL,
  BEST_PARTNER_RANKING_NOTE,
  HISTORICAL_PLAYER_LABEL,
  MATCH_HISTORY_EMPTY_MESSAGE,
  NO_PARTNERS_IN_SCOPE_MESSAGE,
  PERFORMANCE_INTRO,
  filterPlayersBySearch,
  formatHistoryDiagnostics,
  formatMatchHistoryDate,
  formatMatchHistoryPhase,
  formatMatchHistoryResult,
  formatMatchHistoryScoreline,
  formatMatchHistorySource,
  formatPerformanceScopeTitle,
  formatPointDifference,
  formatRecordLine,
  formatWinRatePercent,
  keepDomainPartnerOrder,
  modalityFilterOptions,
  modalitySectionTitle,
  partnerFilterOptions,
  rankingQueryFilters,
  resolvePartnerFilter,
  resolveSelectedPlayerId,
  summaryQueryFilters,
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

function MetricLine({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function MatchHistoryList({ matches }) {
  if (!matches || matches.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {MATCH_HISTORY_EMPTY_MESSAGE}
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {matches.map((match) => (
        <li
          key={`${match.sourceType}:${match.sourceId}:${match.roundId}:${match.matchId}`}
          className="rounded-lg border p-2 space-y-1"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-app)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {formatMatchHistoryDate(match.sessionDate)}
          </p>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {formatMatchHistorySource(match)}
          </p>
          {formatMatchHistoryPhase(match) ? (
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              {formatMatchHistoryPhase(match)}
            </p>
          ) : null}
          <p className="text-sm font-bold">{formatMatchHistoryScoreline(match)}</p>
          <p className="text-xs font-semibold">{formatMatchHistoryResult(match.result)}</p>
        </li>
      ))}
    </ol>
  );
}

export default function PlayerPerformanceView({ document, roster = [], competitionsDocument = null }) {
  const built = useMemo(
    () => buildPlayerPerformanceIndex(document, roster, { competitionsDocument }),
    [document, roster, competitionsDocument]
  );
  const players = useMemo(
    () => (built.ok ? listPerformancePlayers(built.index) : []),
    [built]
  );

  const [search, setSearch] = useState('');
  const [scope, setScope] = useState({
    playerId: null,
    lineupSize: null,
    partnerId: null,
  });

  const playerId = resolveSelectedPlayerId(players, scope.playerId);
  const visiblePlayers = filterPlayersBySearch(players, search);
  const lineupSize = playerId === scope.playerId ? scope.lineupSize : null;

  const overall = useMemo(() => {
    if (!built.ok || !playerId) return null;
    return getPlayerPerformance(built.index, playerId);
  }, [built, playerId]);

  const rankingPartners = useMemo(() => {
    if (!built.ok || !playerId) return [];
    return keepDomainPartnerOrder(
      getPlayerPartnerPerformance(built.index, playerId, rankingQueryFilters(lineupSize))
    );
  }, [built, playerId, lineupSize]);

  const partnerHistories = useMemo(() => {
    if (!built.ok || !playerId) return new Map();
    const next = new Map();
    for (const partner of rankingPartners) {
      next.set(partner.partnerId, {
        wins: getPlayerPartnerMatchHistory(built.index, playerId, partner.partnerId, {
          lineupSize,
          result: 'win',
        }),
        losses: getPlayerPartnerMatchHistory(built.index, playerId, partner.partnerId, {
          lineupSize,
          result: 'loss',
        }),
      });
    }
    return next;
  }, [built, playerId, lineupSize, rankingPartners]);

  const partnerId = resolvePartnerFilter(
    playerId === scope.playerId ? scope.partnerId : null,
    rankingPartners
  );

  const summary = useMemo(() => {
    if (!built.ok || !playerId) return null;
    return getPlayerPerformance(
      built.index,
      playerId,
      summaryQueryFilters(lineupSize, partnerId)
    );
  }, [built, playerId, lineupSize, partnerId]);

  const bestPartner = useMemo(() => {
    if (!built.ok || !playerId) return null;
    return getBestPartner(built.index, playerId, rankingQueryFilters(lineupSize));
  }, [built, playerId, lineupSize]);

  const pinScope = (patch) => {
    setScope({
      playerId,
      lineupSize,
      partnerId,
      ...patch,
    });
  };

  const modalityOptions = modalityFilterOptions(overall?.modalities);
  const partnerOptions = partnerFilterOptions(rankingPartners);
  const selectedPlayer = players.find((player) => player.playerId === playerId) ?? null;
  const selectedPartner = rankingPartners.find((partner) => partner.partnerId === partnerId) ?? null;
  const diagnostics = built.ok ? formatHistoryDiagnostics(built.index) : null;
  const scopeTitle = summary
    ? formatPerformanceScopeTitle({
        playerName: summary.playerName,
        partnerName: selectedPartner?.partnerName ?? null,
        lineupSize,
      })
    : '';
  const byLineupTitle = modalitySectionTitle({
    playerName: summary?.playerName,
    partnerName: selectedPartner?.partnerName ?? null,
  });

  const selectPlayer = (nextPlayerId) => {
    setScope({
      playerId: nextPlayerId,
      lineupSize: null,
      partnerId: null,
    });
  };

  if (!built.ok) {
    return (
      <section className="space-y-3" aria-labelledby="performance-title">
        <h2 id="performance-title" className="text-xl font-bold">
          Desempenho dos jogadores
        </h2>
        <div
          role="alert"
          className="rounded-xl border p-4 space-y-2"
          style={surfaceStyle}
        >
          <p className="font-bold">Não foi possível calcular o desempenho.</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            O documento de encontros ou de competições está estruturalmente inválido. Nenhum número
            parcial é exibido.
          </p>
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
    <section className="space-y-4" aria-labelledby="performance-title">
      <div className="space-y-1">
        <h2 id="performance-title" className="text-xl font-bold">
          Desempenho dos jogadores
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {PERFORMANCE_INTRO}
        </p>
      </div>

      {players.length === 0 ? (
        <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          Nenhum jogador disponível para análise.
        </p>
      ) : (
        <>
          <div className="space-y-3 rounded-xl border p-3" style={surfaceStyle}>
            <div>
              <label className="block text-sm font-bold" htmlFor="performance-player-search">
                Buscar jogador
              </label>
              <input
                id="performance-player-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome do jogador"
                className={`mt-1 w-full border rounded-lg p-2 text-sm ${focusClass}`}
                style={controlStyle}
              />
            </div>

            <div>
              <p id="performance-player-list-label" className="text-sm font-bold">
                Jogadores
              </p>
              {visiblePlayers.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhum jogador encontrado para esta busca.
                </p>
              ) : (
                <ul
                  role="listbox"
                  aria-labelledby="performance-player-list-label"
                  className="mt-2 max-h-48 overflow-y-auto space-y-1"
                >
                  {visiblePlayers.map((player) => {
                    const selected = player.playerId === playerId;
                    return (
                      <li key={player.playerId}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => selectPlayer(player.playerId)}
                          className={`w-full text-left rounded-lg border px-3 py-2 cursor-pointer ${focusClass}`}
                          style={{
                            backgroundColor: selected ? 'var(--bg-subtle)' : 'transparent',
                            borderColor: selected ? 'var(--primary)' : 'var(--border-color)',
                            borderWidth: selected ? 2 : 1,
                            color: 'var(--text-main)',
                          }}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className={selected ? 'font-bold' : 'font-semibold'}>
                              {player.playerName}
                              {selected ? ' (selecionado)' : ''}
                            </span>
                            {!player.isCurrentRosterPlayer && (
                              <span
                                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold border"
                                style={{
                                  borderColor: 'var(--border-color)',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {HISTORICAL_PLAYER_LABEL}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {selectedPlayer && summary && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold" htmlFor="performance-modality">
                    Modalidade
                  </label>
                  <select
                    id="performance-modality"
                    value={lineupSize == null ? '' : String(lineupSize)}
                    onChange={(event) =>
                      pinScope({
                        lineupSize: event.target.value === '' ? null : Number(event.target.value),
                      })
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
                <div>
                  <label className="block text-sm font-bold" htmlFor="performance-partner">
                    Parceiro
                  </label>
                  <select
                    id="performance-partner"
                    value={partnerId ?? ''}
                    onChange={(event) => pinScope({ partnerId: event.target.value || null })}
                    className={`mt-1 w-full border rounded-lg p-2 text-sm font-semibold ${focusClass}`}
                    style={controlStyle}
                  >
                    {partnerOptions.map((option) => (
                      <option key={option.value ?? 'all'} value={option.value ?? ''}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {partnerId && (
                <button
                  type="button"
                  onClick={() => pinScope({ partnerId: null })}
                  className={`text-sm font-bold underline cursor-pointer ${focusClass}`}
                  style={{ color: 'var(--primary)' }}
                >
                  Voltar para {ALL_PARTNERS_LABEL.toLowerCase()}
                </button>
              )}

              <div className="space-y-3">
                <h3 className="text-base font-bold" aria-live="polite">
                  {scopeTitle}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <StatCard label="Jogos" value={summary.matches} />
                  <StatCard label="Vitórias" value={summary.wins} />
                  <StatCard label="Derrotas" value={summary.losses} />
                  <StatCard
                    label="Aproveitamento"
                    value={formatWinRatePercent(summary.winRate, summary.matches)}
                  />
                  <StatCard label="Pontos pró" value={summary.pointsFor} />
                  <StatCard label="Pontos contra" value={summary.pointsAgainst} />
                  <StatCard
                    label="Saldo de pontos"
                    value={formatPointDifference(summary.pointDifference)}
                  />
                </div>
                {selectedPartner && (
                  <div className="space-y-2">
                    <details>
                      <summary className={`cursor-pointer text-sm font-bold ${focusClass}`}>
                        {summary.wins} {summary.wins === 1 ? 'vitória' : 'vitórias'} com{' '}
                        {selectedPartner.partnerName}
                      </summary>
                      <div className="mt-2">
                        <MatchHistoryList
                          matches={partnerHistories.get(selectedPartner.partnerId)?.wins}
                        />
                      </div>
                    </details>
                    <details>
                      <summary className={`cursor-pointer text-sm font-bold ${focusClass}`}>
                        {summary.losses} {summary.losses === 1 ? 'derrota' : 'derrotas'} com{' '}
                        {selectedPartner.partnerName}
                      </summary>
                      <div className="mt-2">
                        <MatchHistoryList
                          matches={partnerHistories.get(selectedPartner.partnerId)?.losses}
                        />
                      </div>
                    </details>
                  </div>
                )}
              </div>

              <article className="rounded-xl border p-3 space-y-2" style={surfaceStyle}>
                <h3 className="font-bold">Melhor parceiro</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {BEST_PARTNER_RANKING_NOTE}
                </p>
                {bestPartner ? (
                  <div className="space-y-1">
                    <p className="text-lg font-black">{bestPartner.partnerName}</p>
                    <MetricLine
                      label="Aproveitamento"
                      value={formatWinRatePercent(bestPartner.winRate, bestPartner.matches)}
                    />
                    <MetricLine label="Jogos" value={bestPartner.matches} />
                    <MetricLine label="Vitórias" value={bestPartner.wins} />
                    <MetricLine label="Derrotas" value={bestPartner.losses} />
                    <MetricLine
                      label="Saldo de pontos"
                      value={formatPointDifference(bestPartner.pointDifference)}
                    />
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {NO_PARTNERS_IN_SCOPE_MESSAGE}
                  </p>
                )}
              </article>

              <section className="space-y-2" aria-labelledby="performance-ranking-title">
                <h3 id="performance-ranking-title" className="font-bold">
                  Ranking de parceiros
                </h3>
                {rankingPartners.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {NO_PARTNERS_IN_SCOPE_MESSAGE}
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {rankingPartners.map((partner, index) => {
                      const current = partner.partnerId === partnerId;
                      const history = partnerHistories.get(partner.partnerId);
                      return (
                        <li key={partner.partnerId}>
                          <div
                            className="rounded-xl border p-3 space-y-2"
                            style={{
                              backgroundColor: current ? 'var(--bg-subtle)' : 'var(--bg-surface)',
                              borderColor: current ? 'var(--primary)' : 'var(--border-color)',
                              borderWidth: current ? 2 : 1,
                            }}
                          >
                            <button
                              type="button"
                              aria-current={current ? 'true' : undefined}
                              onClick={() => pinScope({ partnerId: partner.partnerId })}
                              className={`w-full text-left cursor-pointer ${focusClass}`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-bold">
                                  {index + 1}º {partner.partnerName}
                                  {current ? ' (filtro atual)' : ''}
                                </span>
                                <span className="text-sm font-black">
                                  {formatWinRatePercent(partner.winRate, partner.matches)}
                                </span>
                              </span>
                              <span className="mt-1 block text-xs" style={{ color: 'var(--text-muted)' }}>
                                {formatRecordLine(partner)}
                              </span>
                            </button>
                            <details>
                              <summary className={`cursor-pointer text-sm font-bold ${focusClass}`}>
                                {partner.wins} {partner.wins === 1 ? 'vitória' : 'vitórias'}
                              </summary>
                              <div className="mt-2">
                                <MatchHistoryList matches={history?.wins} />
                              </div>
                            </details>
                            <details>
                              <summary className={`cursor-pointer text-sm font-bold ${focusClass}`}>
                                {partner.losses} {partner.losses === 1 ? 'derrota' : 'derrotas'}
                              </summary>
                              <div className="mt-2">
                                <MatchHistoryList matches={history?.losses} />
                              </div>
                            </details>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <section className="space-y-2" aria-labelledby="performance-modality-title">
                <h3 id="performance-modality-title" className="font-bold">
                  {byLineupTitle}
                </h3>
                {summary.byLineupSize.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Ainda não há partidas neste recorte.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[28rem] text-sm">
                      <caption className="sr-only">{byLineupTitle}</caption>
                      <thead>
                        <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                          <th scope="col" className="py-2 pr-2 font-semibold">
                            Modalidade
                          </th>
                          <th scope="col" className="py-2 pr-2 font-semibold">
                            Jogos
                          </th>
                          <th scope="col" className="py-2 pr-2 font-semibold">
                            Vitórias
                          </th>
                          <th scope="col" className="py-2 pr-2 font-semibold">
                            Derrotas
                          </th>
                          <th scope="col" className="py-2 pr-2 font-semibold">
                            Aproveitamento
                          </th>
                          <th scope="col" className="py-2 font-semibold">
                            Saldo
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byLineupSize.map((row) => (
                          <tr key={row.lineupSize} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                            <th scope="row" className="py-2 pr-2 font-bold text-left">
                              {formatPerformanceModality(row.lineupSize)}
                            </th>
                            <td className="py-2 pr-2">{row.matches}</td>
                            <td className="py-2 pr-2">{row.wins}</td>
                            <td className="py-2 pr-2">{row.losses}</td>
                            <td className="py-2 pr-2">
                              {formatWinRatePercent(row.winRate, row.matches)}
                            </td>
                            <td className="py-2">{formatPointDifference(row.pointDifference)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
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
          {diagnostics.invalidWarning && (
            <p role="status" className="font-semibold" style={{ color: 'var(--text-main)' }}>
              {diagnostics.invalidWarning}
            </p>
          )}
          <p>{diagnostics.modalityNote}</p>
        </aside>
      )}
    </section>
  );
}
